import { afterAll, beforeAll, expect, test } from "bun:test";
import { EngineClient, type WebhookEvent } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import type { TurnDriver } from "../../drivers";
import { EngineWorker } from "../../worker";
import { STUB_CAPABILITIES } from "../../../test/stub-driver";
import { stubModels } from "../../../test/stub-models";
import { eventually } from "../../../test/wait";
import { engineHome, removeTmp, repo, tmp } from "../../../test/worktree-fixtures";

const driver: TurnDriver = { capabilities: STUB_CAPABILITIES, run: async ({ prompt }) => ({ text: `echo:${prompt}` }) };

let daemon: EngineDaemon;
let worker: EngineWorker;
let client: EngineClient;
let answer = 200;
const received: { event: WebhookEvent; authorization: string | null }[] = [];
const receiver = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push({ event: (await request.json()) as WebhookEvent, authorization: request.headers.get("authorization") });
    return new Response(null, { status: answer });
  },
});

const putWebhook = (body: unknown) =>
  fetch(`http://${daemon.discovery.host}:${daemon.discovery.port}/v2/push/webhook`, {
    method: "PUT",
    headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const finishTurn = async (sessionId: string, runId: string) => {
  await client.submitTurn(sessionId, { runId, input: "hello" });
  await eventually(async () => expect((await client.session(sessionId)).turns.find((turn) => turn.runId === runId)?.state).toBe("completed"));
};

beforeAll(async () => {
  daemon = await startEngine({ models: stubModels, engineRoot: engineHome("telar-webhook-"), remoteDir: tmp("telar-webhook-remote-"), workerLeaseMs: 60_000, notifier: () => true });
  client = new EngineClient(daemon.discovery);
  worker = new EngineWorker({ client, workerId: "worker_webhook", driver, pollMs: 25 });
  await worker.start();
  await client.registerProject({ id: "project_hook", name: "Hooked", root: repo() });
  expect((await putWebhook({ url: `http://127.0.0.1:${receiver.port}/hook`, secret: "hook-secret" })).status).toBe(200);
});

afterAll(async () => {
  await worker?.stop();
  await daemon?.close();
  await receiver.stop(true);
  removeTmp();
});

test("a session that finishes a turn is POSTed to the webhook once", async () => {
  await client.createSession({ id: "session_hook", projectId: "project_hook", envMode: "local" });
  await finishTurn("session_hook", "run_one");
  await eventually(() => expect(received.filter(({ event }) => event.sessionId === "session_hook")).toHaveLength(1));
  expect(received[0]).toMatchObject({
    authorization: "Bearer hook-secret",
    event: { event: "session.finished", sessionId: "session_hook", project: { id: "project_hook", name: "Hooked" } },
  });
});

test("a receiver that fails does not stop turns from running", async () => {
  answer = 500;
  await finishTurn("session_hook", "run_two");
  await eventually(() => expect(received.filter(({ event }) => event.sessionId === "session_hook").length).toBeGreaterThanOrEqual(2));
  await finishTurn("session_hook", "run_three");
  expect((await client.health()).daemonId).toBe(daemon.discovery.daemonId);
});
