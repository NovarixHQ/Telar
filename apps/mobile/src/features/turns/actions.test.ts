import { expect, test } from "bun:test";
import { HostConnection } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { answerRequest, promoteTurn, stopSession, withdrawTurn } from "./actions";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";

async function online() {
  const posted: { path: string; body: unknown }[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({});
    },
  });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock() });
  host.start();
  await until(host, "online");
  return { host, posted };
}

test("Stop ends the live turn and what was queued behind it", async () => {
  const { host, posted } = await online();
  await stopSession(host, "s1");
  expect(posted).toEqual([{ path: "/api/sessions/s1/stop", body: { scope: "session", by: "user" } }]);
});

test("an answer carries the person's decision, a decline its reason and a question its answers by field", async () => {
  const { host, posted } = await online();
  await answerRequest(host, "s1", "req_1", "acceptForSession");
  await answerRequest(host, "s1", "req_2", "decline", { reason: "Use the staging folder" });
  await answerRequest(host, "s1", "req_3", "accept", { answers: { branch: "main", checks: ["lint", "test"] } });
  expect(posted).toEqual([
    { path: "/api/sessions/s1/requests/req_1", body: { decision: "acceptForSession" } },
    { path: "/api/sessions/s1/requests/req_2", body: { decision: "decline", reason: "Use the staging folder" } },
    { path: "/api/sessions/s1/requests/req_3", body: { decision: "accept", answers: { branch: "main", checks: ["lint", "test"] } } },
  ]);
});

test("a queued message can be sent into the running turn or withdrawn", async () => {
  const { host, posted } = await online();
  await promoteTurn(host, "s1", "run_2");
  await withdrawTurn(host, "s1", "run_3");
  expect(posted.map(({ path }) => path)).toEqual(["/api/sessions/s1/turns/run_2/promote", "/api/sessions/s1/stop"]);
  expect(posted[1]!.body).toMatchObject({ runId: "run_3" });
});
