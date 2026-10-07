const { afterEach, describe, expect, test } = require("bun:test");
const path = require("node:path");
const { FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const { openSurfaceWindow } = require("./surface-window");

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
