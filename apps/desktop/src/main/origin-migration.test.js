const { afterEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { resetElectron, userData } = require("../../test/fake-electron");
const { migrateLegacyOrigin } = require("./origin-migration");

afterEach(() => {
  fs.rmSync(path.join(userData, "origin-migration.json"), { force: true });
  resetElectron();
});

function fakeWindow({ stored = [["telar-appearance", "{}"], ["telar:keybindings", "[]"]], fail = false } = {}) {
  const calls = [];
  const win = {
    calls,
    destroyed: false,
    loadURL: async (url) => {
      calls.push(["load", url]);
      if (fail && url.startsWith("http")) throw new Error("ERR_CONNECTION_REFUSED");
    },
    destroy() {
      win.destroyed = true;
    },
    webContents: {
      executeJavaScript: async (script) => {
        calls.push(["run", script]);
        return script.includes("Object.entries") ? JSON.stringify(stored) : stored.length;
      },
      session: { flushStorageData: async () => calls.push(["flush"]) },
    },
  };
  return win;
}

const run = (win, over = {}) =>
  migrateLegacyOrigin({ legacyPort: 4100, listeningPort: 4100, appUrl: "telar://app/", createWindow: () => win, log: () => {}, ...over });

describe("the one-time move off http://127.0.0.1:<port>", () => {
  test("reads every key from the old origin, writes the missing ones into telar://app, then stops", async () => {
    const win = fakeWindow();
    expect(await run(win)).toBe("migrated");
    expect(win.calls.filter(([kind]) => kind === "load").map(([, url]) => url)).toEqual(["http://127.0.0.1:4100/v2/ping", "telar://app/migrate"]);
    const write = win.calls.find(([kind, script]) => kind === "run" && script.includes("setItem"))[1];
    expect(write).toContain('"telar-appearance"');
    expect(write).toContain("getItem(key) === null");
    expect(win.calls.some(([kind]) => kind === "flush")).toBe(true);
    expect(win.destroyed).toBe(true);

    const again = fakeWindow();
    expect(await run(again)).toBe("done");
    expect(again.calls).toEqual([]);
  });

  test("a fresh install has nothing to move and never opens a window", async () => {
    const win = fakeWindow();
    expect(await run(win, { legacyPort: null })).toBe("fresh");
    expect(win.calls).toEqual([]);
  });

  test("an old port the engine no longer listens on is given up on, not retried forever", async () => {
    const win = fakeWindow();
    expect(await run(win, { listeningPort: 4200 })).toBe("unreachable");
    expect(await run(win, { listeningPort: 4100 })).toBe("done");
    expect(win.calls).toEqual([]);
  });

  test("a failed read leaves the migration to run again next launch", async () => {
    const lines = [];
    expect(await run(fakeWindow({ fail: true }), { log: (line) => lines.push(line) })).toBe("failed");
    expect(lines[0]).toContain("will retry");
    expect(await run(fakeWindow())).toBe("migrated");
  });

  test("values with quotes and script-like text are written as data", async () => {
    const win = fakeWindow({ stored: [["telar:prompt-stash:v1", '[{"text":"</script>\'; alert(1)"}]']] });
    await run(win);
    const write = win.calls.find(([kind, script]) => kind === "run" && script.includes("setItem"))[1];
    const entries = new Function(`return ${write.slice(0, write.indexOf(").forEach"))})`)();
    expect(entries).toEqual([["telar:prompt-stash:v1", '[{"text":"</script>\'; alert(1)"}]']]);
  });
});
