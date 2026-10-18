import { type RunView } from "@telar/engine-client";
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { terminalLauncher } from "./launcher";
import { RunManager } from "./manager";
import { type StartRunInput } from "./live-run";
import { EngineStore } from "../../state";
import { sessionLifecycleRoutes } from "../sessions";
import { fakeHost } from "../../../test/pty-fakes";

const HOUR = 60 * 60 * 1000;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function scene() {
  const { host, busy } = fakeHost();
  const sessionCloses: string[] = [];
  const idleCloses: string[] = [];
  const closeSession = host.closeSession.bind(host);
  const closeIdle = host.closeIdle.bind(host);
  host.closeSession = (sessionId) => (sessionCloses.push(sessionId), closeSession(sessionId));
  host.closeIdle = (sessionId) => (idleCloses.push(sessionId), closeIdle(sessionId));
  const held = (sessionId: string) => host.sessionCounts()[sessionId] ?? 0;
  const personShell = async (sessionId: string) => (await host.open({ origin: "user", sessionId }, { data() {}, ending() {} })).id;
  const has = (id: string) => host.list().some((terminal) => terminal.id === id);
  const closedByPerson: RunView[] = [];
  const manager = new RunManager({ launcher: terminalLauncher(host), closeSettleMs: 150, personClosed: (run) => closedByPerson.push(run) });
  cleanups.push(() => manager.shutdown());

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-settle-terminals-"));
  cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, "claude-default-model.json"), JSON.stringify({ model: "claude-opus-5[1m]", at: 1 }));
  let now = 1_000 * HOUR;
  const store = new EngineStore(home, () => now);
  store.sessionTerminals.attach(manager);
  store.projectRegistry.register({ id: "project_one", name: "One", root: home });
  store.lifecycle.createSession({ id: "session_one", projectId: "project_one" });
  store.lifecycle.createSession({ id: "session_two", projectId: "project_one" });

  const open = (sessionId: string, overrides: Partial<StartRunInput> = {}) =>
    manager.start({
      projectId: "project_one",
      sessionId,
      config: { id: "", projectId: "project_one", name: "dev", command: "sleep 60", createdAt: 1, updatedAt: 1 },
      worktreePath: home,
      origin: "agent",
      openedBy: "agent",
      ...overrides,
    });
  return { host, busy, sessionCloses, idleCloses, held, personShell, has, manager, store, closedByPerson, open, advance: (ms: number) => (now += ms) };
}

test("an explicit settle closes the session's idle terminals, as Telar, with no note to the agent", async () => {
  const { sessionCloses, idleCloses, personShell, has, manager, store, closedByPerson, open } = await scene();
  const agents = [await open("session_one"), await open("session_one", { origin: "run", openedBy: "person" })];
  const shell = await personShell("session_one");
  const other = await open("session_two");

  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  const ended = await store.settler.endLeftovers("session_one");

  expect(idleCloses).toEqual(["session_one"]);
  expect(sessionCloses).toEqual([]);
  expect(ended).toEqual({ terminals: 3, backgroundTasks: 0 });
  expect(has(shell)).toBe(false);
  for (const run of agents) expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(closedByPerson).toEqual([]);
  expect(manager.run(other.terminalId).status).toBe("running");
  expect(manager.openCount("session_two")).toBe(1);
  expect(manager.openSessions()).toEqual(["session_two"]);
});

test("archiving a session closes its terminals, as Telar", async () => {
  const { personShell, has, manager, store, open } = await scene();
  const run = await open("session_one");
  const shell = await personShell("session_one");
  const other = await open("session_two");
  const archive = sessionLifecycleRoutes(store, () => {}).find((route) => route.method === "POST" && String(route.path).includes("archive"))!;

  await archive.handle({ params: ["session_one"], body: {} } as never);

  expect(store.records.get("session_one").state).toBe("archived");
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(has(shell)).toBe(false);
  expect(manager.run(other.terminalId).status).toBe("running");
});

test("settling a session with nothing open closes nothing and still answers", async () => {
  const { idleCloses, store } = await scene();
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  expect(await store.settler.endLeftovers("session_one")).toEqual({ terminals: 0, backgroundTasks: 0 });
  expect(idleCloses).toEqual(["session_one"]);
});

test("the clock's settle closes the idle terminals on the next sweep, as Telar", async () => {
  const { idleCloses, manager, store, closedByPerson, open, advance } = await scene();
  const run = await open("session_one");
  const window = store.settings.inbox().autoSettleAfterHours!;

  advance(window * HOUR - 60_000);
  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  expect(manager.run(run.terminalId).status).toBe("running");

  advance(2 * 60_000);
  expect(await store.sessionTerminals.sweepSettled()).toEqual(["session_one"]);
  expect(idleCloses).toEqual(["session_one"]);
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(closedByPerson).toEqual([]);
});

test("a session the clock has not settled keeps its terminals, however long they run", async () => {
  const { idleCloses, manager, store, open, advance } = await scene();
  const run = await open("session_one");
  store.lifecycle.updateSession("session_one", { settledOverride: "active" });
  advance(30 * 24 * HOUR);
  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  expect(idleCloses).toEqual([]);
  expect(manager.run(run.terminalId).status).toBe("running");
});

test("live background work holds the clock off (#965), so its terminals stay; an explicit settle ends both", async () => {
  const { manager, store, open, advance } = await scene();
  store.intake.submitTurn("session_one", { runId: "run_bg", input: "Watch the build" });
  const claimed = store.claims.claimNextTurn("worker_one")!;
  const token = claimed.turn.claim!.token;
  store.turnLifecycle.markRunning("session_one", "run_bg", token);
  store.ingest.ingestObservations("session_one", "run_bg", token, [
    { kind: "task.started", task: { id: "task_bg", providerTaskId: "bg1", kind: "background", backgrounded: true, state: "running", title: "Tail the log" } },
  ]);
  store.turnLifecycle.completeTurn("session_one", "run_bg", token, { text: "Watching" });
  store.records.markRead("session_one", "run_bg");
  const run = await open("session_one");
  expect(store.records.get("session_one").activity).toBe("monitoring");

  advance(30 * 24 * HOUR);
  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  expect(manager.run(run.terminalId).status).toBe("running");

  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  expect(await store.settler.endLeftovers("session_one")).toEqual({ terminals: 1, backgroundTasks: 1 });
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(store.records.get("session_one").activity).toBe("idle");
});

test("quitting Telar closes every session's terminals, recorded as Telar's, with no note to any agent", async () => {
  const { host, manager, closedByPerson, open } = await scene();
  const runs = [await open("session_one"), await open("session_two")];
  expect(await host.closeAll()).toBe(2);
  for (const run of runs) {
    await manager.wait(run.terminalId, { exit: true, timeoutMs: 2000 });
    expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  }
  expect(closedByPerson).toEqual([]);
  expect(manager.openSessions()).toEqual([]);
});

test("a host out of reach does not fail the settle, and leaves the records as they were", async () => {
  const { manager, store, open } = await scene();
  const run = await open("session_one");
  store.sessionTerminals.attach({
    openCount: (sessionId) => manager.openCount(sessionId),
    openSessions: () => manager.openSessions(),
    closeSession: async () => {
      throw new Error("connect ECONNREFUSED");
    },
    closeIdle: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  expect(await store.settler.endLeftovers("session_one")).toEqual({ terminals: 0, backgroundTasks: 0 });
  expect(store.records.get("session_one").settledOverride).toBe("settled");
  expect(manager.run(run.terminalId).status).toBe("running");
});
