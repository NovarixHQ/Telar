import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import type { TurnDriver } from "./drivers";
import { startEngine, type EngineDaemon } from "./daemon";
import { engineRootFromEnv } from "./platform/fs/engine-root";
import { EngineWorker } from "./worker";
import { stubModels } from "../test/stub-models";
import { eventually } from "../test/wait";
import { removeTmp, repo, tmp } from "../test/worktree-fixtures";
import { STUB_CAPABILITIES } from "../test/stub-driver";

const driver: TurnDriver = {
  capabilities: STUB_CAPABILITIES,
  async run({ prompt, onObservations }) {
    await onObservations([
      { kind: "item.started", item: { id: "answer", detail: { type: "assistant_message", text: "" } } },
      { kind: "content.delta", itemId: "answer", stream: "assistant_text", text: `echo:${prompt}` },
      { kind: "item.completed", itemId: "answer", status: "completed" },
    ]);
    return { text: `echo:${prompt}` };
  },
};

let home: string;
let previousHome: string | undefined;
let daemon: EngineDaemon;
let worker: EngineWorker;
let client: EngineClient;

beforeAll(async () => {
  previousHome = process.env.TELAR_HOME;
  home = tmp("telar-headless-");
  process.env.TELAR_HOME = home;
  daemon = await startEngine({ models: stubModels, engineRoot: engineRootFromEnv(), workerLeaseMs: 60_000, notifier: () => true });
  client = new EngineClient(daemon.discovery);
  worker = new EngineWorker({ client, workerId: "worker_headless", driver, pollMs: 25 });
  await worker.start();
});

afterAll(async () => {
  await worker?.stop();
  await daemon?.close();
  if (previousHome === undefined) delete process.env.TELAR_HOME;
  else process.env.TELAR_HOME = previousHome;
  removeTmp();
});

test("pairs a device, runs a turn and shuts down inside its home", async () => {
  const base = `http://${daemon.discovery.host}:${daemon.discovery.port}`;
  const call = async (route: string, body: unknown) => {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, any>;
  };

  const minted = await call("/v2/remote/pairing", {});
  const paired = await call("/v2/remote/pair", { code: minted.code, name: "CI phone", identity: { kind: "phone" } });
  expect(paired.deviceToken).toMatch(/^tlr_/);
  const decision = await call("/v2/auth/decide", { pathname: "/api/projects", method: "GET", authorization: `Bearer ${paired.deviceToken}` });
  expect(decision.allow).toBe(true);

  const checkout = repo();
  await client.registerProject({ id: "project_headless", name: "Headless", root: checkout });
  await client.createSession({ id: "session_headless", projectId: "project_headless", envMode: "local" });
  await client.submitTurn("session_headless", { runId: "run_headless", input: "hello" });
  await eventually(async () => expect((await client.session("session_headless")).turns.find((turn) => turn.runId === "run_headless")?.state).toBe("completed"));
  expect((await client.turnAnswer("session_headless", { runId: "run_headless" })).text).toContain("echo:hello");

  await worker.stop();
  await daemon.close();
  expect(fs.existsSync(path.join(home, "engine"))).toBe(true);
});
