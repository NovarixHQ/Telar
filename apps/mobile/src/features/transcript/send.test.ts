import { expect, test } from "bun:test";
import { HostConnection } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { sendMessage } from "./send";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";

test("a message is posted as a new turn with a run id minted on the phone", async () => {
  const bodies: unknown[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ turn: { runId: "run_x" } });
    },
  });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock() });
  host.start();
  await until(host, "online");
  await sendMessage(host, "s1", "hello", "run_fixed");
  expect(network.seen.at(-1)).toMatchObject({ url: `${MAC}/api/sessions/s1/turns`, method: "POST" });
  expect(bodies).toEqual([{ runId: "run_fixed", input: "hello" }]);
});

test("a send that loses its address is not posted twice", async () => {
  let up = true;
  const network = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : up ? Response.json({}) : "unreachable") });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock() });
  host.start();
  await until(host, "online");
  up = false;
  await expect(sendMessage(host, "s1", "hello")).rejects.toMatchObject({ code: "engine_unavailable" });
  expect(network.seen.filter((call) => call.method === "POST")).toHaveLength(1);
});
