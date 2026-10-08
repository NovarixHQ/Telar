import { expect, test } from "bun:test";
import { HostConnection } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { setAccessMode, setSessionModel } from "./actions";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";

async function online() {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      sent.push({ method: init.method ?? "GET", path, body: JSON.parse(String(init.body)) });
      return Response.json({ session: {} });
    },
  });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock() });
  host.start();
  await until(host, "online");
  return { host, sent };
}

test("a model choice patches the session's model on its provider instance", async () => {
  const { host, sent } = await online();
  await setSessionModel(host, "s1", "claude", { model: "opus", effort: "high" });
  await setSessionModel(host, "s1", "claude", {});
  expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
    ["PATCH", "/api/sessions/s1", { model: { instanceId: "claude", model: "opus", effort: "high" } }],
    ["PATCH", "/api/sessions/s1", { model: null }],
  ]);
});

test("an access mode patches the session's runtime mode", async () => {
  const { host, sent } = await online();
  await setAccessMode(host, "s1", "full-access");
  expect(sent).toEqual([{ method: "PATCH", path: "/api/sessions/s1", body: { runtimeMode: "full-access" } }]);
});
