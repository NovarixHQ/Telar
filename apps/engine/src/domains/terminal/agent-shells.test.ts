import { afterAll, afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunLaunchEvents, RunLauncher } from "./launcher";
import { RunManager } from "./manager";
import { RunStore } from "./store";
import { storeRunCapability } from "./store-capability";
import { runTools } from "./tools";

const PROMPT = "\x1b]133;A\x07% ";
const finished = (code: number) => `\x1b]133;D;${code}\x07${PROMPT}`;

const tempDirs: string[] = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-agent-shells-"));
  tempDirs.push(dir);
  return dir;
};
const managers: RunManager[] = [];
afterEach(async () => {
  while (managers.length) await managers.pop()!.shutdown();
});
afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function surface(options: { cap?: number; idleMs?: number } = {}) {
  const events = new Map<string, RunLaunchEvents>();
  let clock = 1_000;
  const launcher: RunLauncher = {
    kind: "pty",
    async launch(_request, sink) {
      const terminalId = `term_${events.size + 1}`;
      events.set(terminalId, sink);
      return {
        pid: 40_000 + events.size,
        terminalId,
        close: async () => sink.exited({ exitCode: 0, closed: "close" }),
        signal: async () => {},
        write: async () => true,
        resize: async () => true,
      };
    },
  };
  const manager = new RunManager({
    launcher,
    platform: "darwin",
    env: { SHELL: "/bin/zsh" },
    shellDir: temp(),
    now: () => clock,
    ...(options.cap === undefined ? {} : { agentShellCap: options.cap }),
    ...(options.idleMs === undefined ? {} : { agentShellIdleMs: options.idleMs }),
  });
  managers.push(manager);
  const store = new RunStore(temp());
  const tree = temp();
  fs.mkdirSync(path.join(tree, "web"));
  const capability = storeRunCapability({ store, manager, context: () => ({ sessionId: "s", projectId: "p", worktreePath: tree }) });
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ content: { text?: string }[] }>>();
  runTools((name, _description, _shape, handler) => {
    tools.set(name, handler as never);
    return name;
  }, capability);
  const call = async (name: string, args: Record<string, unknown> = {}) => (await tools.get(name)!(args)).content.map((part) => part.text ?? "").join("\n");
  const settle = (id: string) => {
    events.get(id)!.output("stdout", PROMPT);
    events.get(id)!.output("stdout", finished(0));
  };
  const openIdle = async (command: string, args: Record<string, unknown> = {}) => {
    const id = idIn(await call("terminal_open", { command, ...args }));
    settle(id);
    return id;
  };
  const personRun = async (command: string) => {
    const config = store.create("p", { name: command, command });
    const { terminalId } = await manager.start({ projectId: "p", sessionId: "s", config, worktreePath: tree, openedBy: "person" });
    settle(terminalId);
    return terminalId;
  };
  return { manager, call, openIdle, personRun, tick: (ms: number) => (clock += ms), opened: () => events.size };
}

const idIn = (text: string) => /terminalId: (term_\d+)/.exec(text)![1]!;

test("terminal_open types into the session's idle shell in the same directory instead of opening a tab", async () => {
  const { call, openIdle, opened, manager } = surface();
  const first = await openIdle("aws login");

  const answer = await call("terminal_open", { command: "./deploy.sh", name: "deploy" });
  expect(idIn(answer)).toBe(first);
  expect(answer).toContain("Reused your idle terminal");
  expect(opened()).toBe(1);
  expect(manager.run(first)).toMatchObject({ activity: "busy", command: "./deploy.sh" });
});

test("terminal_open opens a new shell while the idle one is busy, in another directory, or when asked fresh", async () => {
  const { call, openIdle, opened } = surface();
  const idle = await openIdle("ls");

  const elsewhere = await call("terminal_open", { command: "bun run dev", cwd: "web" });
  expect(idIn(elsewhere)).not.toBe(idle);
  expect(elsewhere).toContain(`You also have idle terminal ${idle}`);

  const fresh = await call("terminal_open", { command: "bun test", fresh: true });
  expect(idIn(fresh)).not.toBe(idle);

  expect(idIn(await call("terminal_open", { command: "bun run build" }))).toBe(idle);
  const whileBusy = await call("terminal_open", { command: "bun run lint" });
  expect(idIn(whileBusy)).not.toBe(idle);
  expect(opened()).toBe(4);
});

test("past the cap, opening closes the longest-idle agent shell, never a busy one or a person's run", async () => {
  const { call, openIdle, personRun, tick, manager } = surface({ cap: 3 });
  const person = await personRun("bun run web");
  const oldest = await openIdle("one", { fresh: true });
  tick(1_000);
  const newer = await openIdle("two", { fresh: true });
  tick(1_000);
  const busy = idIn(await call("terminal_open", { command: "bun run dev", fresh: true }));

  const fourth = idIn(await call("terminal_open", { command: "four", fresh: true }));
  expect(manager.run(oldest)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect([newer, busy, person, fourth].map((id) => manager.run(id).status)).toEqual(["running", "running", "running", "running"]);
});

test("when every agent shell at the cap is busy, opening one more still works", async () => {
  const { call, manager } = surface({ cap: 2 });
  const ids = [
    idIn(await call("terminal_open", { command: "bun run dev" })),
    idIn(await call("terminal_open", { command: "bun run worker" })),
    idIn(await call("terminal_open", { command: "bun test" })),
  ];
  expect(new Set(ids).size).toBe(3);
  expect(ids.map((id) => manager.run(id).status)).toEqual(["running", "running", "running"]);
});

test("agent shells idle past the limit close as Telar; busy ones and a person's runs stay", async () => {
  const { call, openIdle, personRun, tick, manager } = surface({ idleMs: 30 * 60_000 });
  const idle = await openIdle("aws login");
  const busy = idIn(await call("terminal_open", { command: "bun run dev", fresh: true }));
  const person = await personRun("bun run web");

  tick(29 * 60_000);
  expect(await manager.closeIdleAgentShells()).toBe(0);
  tick(60_000);
  expect(await manager.closeIdleAgentShells()).toBe(1);
  expect(manager.run(idle)).toMatchObject({ status: "closed", closedBy: "telar" });
  expect(manager.run(busy).status).toBe("running");
  expect(manager.run(person).status).toBe("running");

  const listed = await call("terminal_list");
  expect(listed).not.toContain(idle);
  expect(listed).toContain("1 ended terminal(s) not listed");
});
