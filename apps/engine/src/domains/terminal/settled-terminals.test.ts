import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunView } from "@telar/engine-client";
import { terminalLauncher } from "./launcher";
import { RunManager } from "./manager";
import { type StartRunInput } from "./live-run";
import { EngineStore } from "../../state";
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

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-settled-terminals-"));
  cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, "claude-default-model.json"), JSON.stringify({ model: "claude-opus-5[1m]", at: 1 }));
  let now = 1_000 * HOUR;
  const store = new EngineStore(home, () => now);
  store.sessionTerminals.attach(manager);
  store.projectRegistry.register({ id: "project_one", name: "One", root: home });
  for (const id of ["session_one", "session_two", "session_three", "session_four"]) store.lifecycle.createSession({ id, projectId: "project_one" });

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
  const advance = (ms: number) => (now += ms);
  const settle = (sessionId: string) => {
    store.lifecycle.updateSession(sessionId, { settledOverride: "settled" });
    advance(60_000);
  };
  return { host, busy, sessionCloses, idleCloses, held, personShell, has, manager, store, closedByPerson, open, advance, settle };
}

test("the automatic settle's sweep closes a shell the person opened, which only the host can see", async () => {
  const { personShell, has, manager, store, advance } = await scene();
  const shell = await personShell("session_one");
  expect(manager.openSessions()).toEqual([]);
  const window = store.settings.inbox().autoSettleAfterHours!;

  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  expect(has(shell)).toBe(true);

  advance(window * HOUR + 60_000);
  expect(await store.sessionTerminals.sweepSettled()).toEqual(["session_one"]);
  expect(has(shell)).toBe(false);
  expect(store.records.get("session_one").terminalsClosed).toMatchObject({ terminals: 1 });
  expect(store.live.rows({ all: true }).terminals).toEqual({});
});

test("the counts include the person's shells: what Settle would close, and what the rail is told", async () => {
  const { personShell, store, open } = await scene();
  await open("session_one");
  await personShell("session_one");
  await personShell("session_three");
  const before = store.live.revision();

  expect(await store.sessionTerminals.countNow("session_one")).toBe(2);
  expect(await store.sessionTerminals.countNow("session_two")).toBe(0);
  expect(store.live.rows().terminals).toEqual({ session_one: 2, session_three: 1 });
  expect(store.live.revision()).toBeGreaterThan(before);

  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  expect(await store.settler.endLeftovers("session_one")).toEqual({ terminals: 2, backgroundTasks: 0 });
  expect(store.live.rows({ all: true }).terminals).toEqual({ session_three: 1 });
});

test("a settled session keeps a terminal still running something, and the sweep closes it once it is idle", async () => {
  const { busy, personShell, has, manager, store, open, settle } = await scene();
  const run = await open("session_one");
  busy.add(run.pid!);
  const shell = await personShell("session_one");
  settle("session_one");

  expect(await store.settler.endLeftovers("session_one")).toEqual({ terminals: 1, backgroundTasks: 0 });
  expect(has(shell)).toBe(false);
  expect(manager.run(run.terminalId).status).toBe("running");
  expect(store.live.rows({ all: true }).terminals).toEqual({ session_one: 1 });

  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  busy.delete(run.pid!);
  expect(await store.sessionTerminals.sweepSettled()).toEqual(["session_one"]);
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(store.records.get("session_one").terminalsClosed).toMatchObject({ terminals: 1 });
});

test("the person closing a settled session's terminals is recorded as the person's", async () => {
  const { personShell, manager, store, closedByPerson, open, settle } = await scene();
  const run = await open("session_one");
  await personShell("session_one");
  settle("session_one");
  expect(await store.sessionTerminals.closeForPerson("session_one")).toBe(2);
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "person" });
  expect(closedByPerson.map((view) => view.terminalId)).toEqual([run.terminalId]);
  expect(store.records.get("session_one").terminalsClosed).toBeUndefined();
  expect(store.live.rows({ all: true }).terminals).toEqual({});
});
