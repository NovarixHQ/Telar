const { afterAll, beforeAll, beforeEach, describe, expect, test } = require("bun:test");
const { electron, eventFrom, FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const hosts = require("./browser-hosts");
const { TerminalOwner } = require("../terminal/terminal-host");
const { createTerminalReaders } = require("./terminal-readers");
const { registerTerminalIpc } = require("./ipc-terminal");

const RENDERER = TerminalOwner.RENDERER;

function fakeHost() {
  const terminals = new Map();
  let next = 0;
  return {
    written: [],
    async open({ owner }) {
      const id = `term_${(next += 1)}`;
      terminals.set(id, { id, owner, pid: 100 + next });
      return { id, pid: 100 + next };
    },
    list: (owner) => [...terminals.values()].filter((entry) => entry.owner === owner),
    write(id, data) {
      this.written.push([id, data]);
      return terminals.has(id);
    },
    async close(id) {
      return terminals.delete(id);
    },
    async activeProcesses({ ids }) {
      return ids.filter((id) => terminals.has(id)).map((id) => ({ id, active: true }));
    },
  };
}

function cockpitWindow() {
  const win = new FakeBrowserWindow();
  const manager = { window: win, windowOfSender: (sender) => (sender === win.webContents ? win : null) };
  hosts.addHost(win, manager);
  return { win, manager };
}

let host;
let a;
let b;
beforeAll(() => {
  resetElectron();
  a = cockpitWindow();
  b = cockpitWindow();
});

beforeEach(() => {
  host = fakeHost();
  registerTerminalIpc({ RENDERER, requireTerminalHost: () => host, terminalReaders: createTerminalReaders({ onOrphaned() {} }) });
});

afterAll(() => {
  hosts.removeHost(a.manager);
  hosts.removeHost(b.manager);
  resetElectron();
});

const invoke = (channel, { win }, input) => electron.ipcMain.invoke(channel, eventFrom(win), input);

describe("each window sees only its own terminals", () => {
  test("list answers with the terminals the asking window opened", async () => {
    const mine = await invoke("telar:terminal:open", a, {});
    const theirs = await invoke("telar:terminal:open", b, {});

    expect((await invoke("telar:terminal:list", a)).terminals.map((entry) => entry.id)).toEqual([mine.id]);
    expect((await invoke("telar:terminal:list", b)).terminals.map((entry) => entry.id)).toEqual([theirs.id]);
  });

  test("busy terminals are reported only for the asking window", async () => {
    const mine = await invoke("telar:terminal:open", a, {});
    const theirs = await invoke("telar:terminal:open", b, {});

    expect((await invoke("telar:terminal:active", a, {})).terminals.map((entry) => entry.id)).toEqual([mine.id]);
    expect((await invoke("telar:terminal:active", a, { ids: [mine.id, theirs.id] })).terminals.map((entry) => entry.id)).toEqual([mine.id]);
  });

  test("a window cannot type into or close another window's terminal", async () => {
    const theirs = await invoke("telar:terminal:open", b, {});

    expect(await invoke("telar:terminal:write", a, { id: theirs.id, data: "ls\n" })).toEqual({ ok: false });
    expect(await invoke("telar:terminal:close", a, { id: theirs.id })).toEqual({ ok: false });
    expect(host.written).toEqual([]);
    expect(await invoke("telar:terminal:write", b, { id: theirs.id, data: "ls\n" })).toEqual({ ok: true });
  });
});
