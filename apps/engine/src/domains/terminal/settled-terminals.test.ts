import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunView } from "@telar/engine-client";
import { terminalLauncher } from "./launcher";
import { RunManager } from "./manager";
import { type StartRunInput } from "./live-run";
import { RunTerminalClient } from "./terminal-client";
import { EngineStore } from "../../state";
import { desktopTerminalServer } from "../../../test/desktop-terminal";

type StartServer = (options: {
  port: number;
  token: string;
  getTerminalHost: () => unknown;
}) => Promise<{ port: number; onExit: (id: string, ending: unknown) => void; close: () => Promise<unknown> }>;
const { startRunTerminalServer } = (await import(desktopTerminalServer)) as { startRunTerminalServer: StartServer };

const HOUR = 60 * 60 * 1000;

type FakeTerminal = { id: string; pid: number; sessionId?: string; owner: "engine" | "renderer"; busy?: boolean };

class FakeHost {
  readonly terminals = new Map<string, FakeTerminal>();
  readonly sessionCloses: string[] = [];
  onExit: (id: string, ending: unknown) => void = () => {};
  private sequence = 0;

  open(request: { sessionId?: string }): unknown {
    const id = `term_${(this.sequence += 1)}`;
    this.terminals.set(id, { id, pid: 40_000 + this.sequence, sessionId: request.sessionId, owner: "engine" });
    return { id, pid: 40_000 + this.sequence };
  }

  personShell(sessionId: string): string {
    const id = `term_${(this.sequence += 1)}`;
    this.terminals.set(id, { id, pid: 40_000 + this.sequence, sessionId, owner: "renderer" });
    return id;
  }

  countBySession(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const terminal of this.terminals.values()) if (terminal.sessionId) counts[terminal.sessionId] = (counts[terminal.sessionId] ?? 0) + 1;
    return counts;
  }

  async killBySession(sessionId: string): Promise<number> {
    this.sessionCloses.push(sessionId);
    const records = [...this.terminals.values()].filter((terminal) => terminal.sessionId === sessionId);
    for (const record of records) {
      this.terminals.delete(record.id);
      if (record.owner === "engine") this.onExit(record.id, { id: record.id, pid: record.pid, fate: "exited", exitCode: 0, signal: "1", at: Date.now(), closed: "session" });
    }
    return records.length;
  }

  async closeIdleBySession(sessionId: string): Promise<string[]> {
    const idle = [...this.terminals.values()].filter((terminal) => terminal.sessionId === sessionId && !terminal.busy);
    for (const record of idle) {
      this.terminals.delete(record.id);
      if (record.owner === "engine") this.onExit(record.id, { id: record.id, pid: record.pid, fate: "exited", exitCode: 0, signal: "1", at: Date.now(), closed: "session" });
    }
    return idle.map((record) => record.id);
  }

  held(sessionId: string): number {
    return [...this.terminals.values()].filter((terminal) => terminal.sessionId === sessionId).length;
  }

  list(): FakeTerminal[] {
    return [...this.terminals.values()].filter((terminal) => terminal.owner === "engine");
  }
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function scene() {
  const host = new FakeHost();
  const server = await startRunTerminalServer({ port: 0, token: "test-token", getTerminalHost: () => host });
  cleanups.push(() => server.close());
  host.onExit = server.onExit;
  const client = new RunTerminalClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "test-token", reconnectMs: 20, reconnectMaxMs: 50 });
  cleanups.push(() => client.detach());
  const closedByPerson: RunView[] = [];
  const manager = new RunManager({ launcher: terminalLauncher(client), closeSettleMs: 150, personClosed: (run) => closedByPerson.push(run) });
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
  return { host, manager, store, closedByPerson, open, advance, settle };
}

test("the automatic settle's sweep closes a shell the person opened, which only the host can see", async () => {
  const { host, manager, store, advance } = await scene();
  const shell = host.personShell("session_one");
  expect(manager.openSessions()).toEqual([]);
  const window = store.settings.inbox().autoSettleAfterHours!;

  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  expect(host.terminals.has(shell)).toBe(true);

  advance(window * HOUR + 60_000);
  expect(await store.sessionTerminals.sweepSettled()).toEqual(["session_one"]);
  expect(host.terminals.has(shell)).toBe(false);
  expect(store.records.get("session_one").terminalsClosed).toMatchObject({ terminals: 1 });
  expect(store.live.rows({ all: true }).terminals).toEqual({});
});

test("the counts include the person's shells: what Settle would close, and what the rail is told", async () => {
  const { host, store, open } = await scene();
  await open("session_one");
  host.personShell("session_one");
  host.personShell("session_three");
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
  const { host, manager, store, open, settle } = await scene();
  const run = await open("session_one");
  host.terminals.get(run.terminalId)!.busy = true;
  const shell = host.personShell("session_one");
  settle("session_one");

  expect(await store.settler.endLeftovers("session_one")).toEqual({ terminals: 1, backgroundTasks: 0 });
  expect(host.terminals.has(shell)).toBe(false);
  expect(manager.run(run.terminalId).status).toBe("running");
  expect(store.live.rows({ all: true }).terminals).toEqual({ session_one: 1 });

  expect(await store.sessionTerminals.sweepSettled()).toEqual([]);
  host.terminals.get(run.terminalId)!.busy = false;
  expect(await store.sessionTerminals.sweepSettled()).toEqual(["session_one"]);
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(store.records.get("session_one").terminalsClosed).toMatchObject({ terminals: 1 });
});

test("the person closing a settled session's terminals is recorded as the person's", async () => {
  const { host, manager, store, closedByPerson, open, settle } = await scene();
  const run = await open("session_one");
  host.personShell("session_one");
  settle("session_one");
  expect(await store.sessionTerminals.closeForPerson("session_one")).toBe(2);
  expect(manager.run(run.terminalId)).toMatchObject({ status: "closed", closedBy: "person" });
  expect(closedByPerson.map((view) => view.terminalId)).toEqual([run.terminalId]);
  expect(store.records.get("session_one").terminalsClosed).toBeUndefined();
  expect(store.live.rows({ all: true }).terminals).toEqual({});
});
