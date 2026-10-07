const { afterEach, describe, expect, test } = require("bun:test");
const path = require("node:path");
const fs = require("node:fs");
const { electron, FakeBrowserWindow, resetElectron, userData } = require("../../test/fake-electron");
const { openSurfaceWindow, restoreBrowserWindows } = require("./surface-window");
const { backdropWindowOptions } = require("../main/window-material");
const { macWindowChrome } = require("../main/window-chrome");

const APP = "http://127.0.0.1:42731/";

afterEach(() => resetElectron());

describe("a surface window", () => {
  test("loads the cockpit's route for that surface, with its params as the query", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "session-1#browser-2", project: "p1" } });
    expect(win.loaded).toEqual(["http://127.0.0.1:42731/surface/browser?scope=session-1%23browser-2&project=p1"]);
  });

  test("leaves an absent param out rather than sending it empty", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "s", project: null } });
    expect(new URL(win.loaded[0]).searchParams.has("project")).toBe(false);
  });

  test("runs the cockpit's sandboxed preload, so the surface gets the same bridge", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "s" } });
    expect(win.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "..", "preload", "preload.js"),
    });
  });

  test("keeps its own title and only appears once it has painted", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "s" } });
    let prevented = false;
    win.emit("page-title-updated", { preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(win.title).toBe("Browser");
    expect(win.options.show).toBe(false);
  });

  test("a link out of the cockpit opens in the system browser, not in the window", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "s" } });
    expect(win.webContents.windowOpenHandler({ url: "https://example.com/" })).toEqual({ action: "deny" });
    expect(FakeBrowserWindow.getAllWindows()).toHaveLength(1);
  });
});

function memoryStore(entries = []) {
  const kept = new Map(entries.map((entry) => [entry.key, entry]));
  return {
    kept,
    forgotten: [],
    list: () => [...kept.values()],
    get: (_kind, key) => kept.get(key) ?? null,
    remember(kind, key, state) { kept.set(key, { kind, key, ...state }); },
    forget(_kind, key) { this.forgotten.push(key); kept.delete(key); },
  };
}

describe("a surface window remembers where it was", () => {
  test("it reopens where it was left, clamped to a display that still exists", () => {
    const store = memoryStore([{ kind: "browser", key: "s", bounds: { x: 1600, y: 100, width: 1200, height: 800 }, displayId: 2, fullscreen: false }]);
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store });
    expect({ x: win.options.x, y: win.options.y, width: win.options.width, height: win.options.height }).toEqual({ x: 240, y: 100, width: 1200, height: 800 });
  });

  test("a new one opens at the default size, and is remembered at once", () => {
    const store = memoryStore();
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store });
    expect(win.options).toMatchObject({ width: 1100, height: 800 });
    expect(store.get("browser", "s")).toMatchObject({ displayId: 1, fullscreen: false });
  });

  test("moving, resizing and full screen are each written down", () => {
    const store = memoryStore();
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store });
    win.bounds = { x: 40, y: 60, width: 700, height: 500 };
    win.emit("move");
    expect(store.get("browser", "s").bounds).toEqual({ x: 40, y: 60, width: 700, height: 500 });
    win.fullscreen = true;
    win.emit("enter-full-screen");
    expect(store.get("browser", "s").fullscreen).toBe(true);
  });

  test("a window left in full screen goes back to full screen once shown", () => {
    const store = memoryStore([{ kind: "browser", key: "s", bounds: { x: 0, y: 25, width: 900, height: 700 }, displayId: 1, fullscreen: true }]);
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store });
    expect(win.isFullScreen()).toBe(false);
    win.emit("ready-to-show");
    expect(win.isFullScreen()).toBe(true);
  });
});

describe("at launch", () => {
  test("every browser that was popped out at quit pops out again, and one with no tabs left is forgotten", () => {
    const store = memoryStore([
      { kind: "browser", key: "kept", bounds: { x: 0, y: 25, width: 900, height: 700 } },
      { kind: "browser", key: "gone", bounds: { x: 0, y: 25, width: 900, height: 700 } },
    ]);
    const popped = [];
    const manager = { popOut: (key) => { if (key === "gone") throw new Error("no tabs"); popped.push(key); } };
    restoreBrowserWindows(manager, store);
    expect(popped).toEqual(["kept"]);
    expect(store.forgotten).toEqual(["gone"]);
  });
});

describe("a surface window that floats on top", () => {
  test("is an ordinary window, never a panel", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store: memoryStore() });
    expect(win.options.type).toBeUndefined();
  });

  test("going compact is written down with where it goes back to, and it reopens compact", () => {
    const { setCompact } = require("./compact-window");
    const store = memoryStore();
    const first = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store });
    first.bounds = { x: 100, y: 100, width: 1000, height: 600 };
    const expanded = first.getNormalBounds();
    setCompact(first, true);
    expect(store.get("browser", "s")).toMatchObject({ compact: true, expanded });

    const again = openSurfaceWindow({ appUrl: APP, kind: "browser", key: "s", params: { scope: "s" }, store });
    expect(again.onTop).toBe("floating");
    expect(again.getNormalBounds()).toEqual(store.get("browser", "s").bounds);
    setCompact(again, false);
    expect(again.getNormalBounds()).toEqual(expanded);
  });
});

describe("it looks like a Telar window", () => {
  const supported = process.platform === "darwin";
  afterEach(() => fs.rmSync(path.join(userData, "ui-prefs.json"), { force: true }));

  test("it wears the Look's backdrop and translucency, exactly as the cockpit does", () => {
    for (const prefs of [{ translucent: true, frost: "blur" }, { translucent: false, frost: "blur" }]) {
      fs.writeFileSync(path.join(userData, "ui-prefs.json"), JSON.stringify(prefs));
      electron.nativeTheme.shouldUseDarkColors = true;
      const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "s" } });
      for (const [key, value] of Object.entries(backdropWindowOptions({ ...prefs, dark: true, supported }))) expect(win.options[key]).toEqual(value);
    }
  });

  test("its traffic lights sit inset in the page's own titlebar band", () => {
    const win = openSurfaceWindow({ appUrl: APP, kind: "browser", params: { scope: "s" } });
    for (const [key, value] of Object.entries(macWindowChrome())) expect(win.options[key]).toEqual(value);
  });
});
