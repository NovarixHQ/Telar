const { afterEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { electron, FakeBrowserWindow, resetElectron, userData } = require("../../test/fake-electron");
const { createCockpitWindow } = require("./cockpit-window");
const { backdropWindowOptions } = require("./window-material");
const { currentHost, lastWindowUrl, requireBrowserManager } = require("./browser-hosts");
const { linkRouting } = require("./window-links");
const { LINK_OPEN_CHANNEL } = require("./link-routing");

const URL_ = "http://127.0.0.1:42731/";
const supported = process.platform === "darwin";

function open(url = URL_) {
  const made = {};
  const win = createCockpitWindow(url, {
    createManager: (window, { onChordScope }) => {
      made.manager = {
        window,
        hidden: 0,
        destroyed: 0,
        extensionHosts: new Map(),
        onChordScope,
        windowOfSender: (sender) => (sender === window.webContents ? window : null),
        hideVisibleScope() { this.hidden += 1; },
        destroy() { this.destroyed += 1; },
      };
      return made.manager;
    },
  });
  return { win, manager: made.manager };
}

function writeUiPrefs(prefs) {
  fs.writeFileSync(path.join(userData, "ui-prefs.json"), JSON.stringify(prefs));
}

afterEach(() => {
  for (const win of FakeBrowserWindow.getAllWindows()) win.close();
  fs.rmSync(path.join(userData, "ui-prefs.json"), { force: true });
  resetElectron();
});

describe("the window is born translucent-capable", () => {
  test("its backdrop is exactly what window-material decides for the stored preference", () => {
    for (const prefs of [{ translucent: true, frost: "blur" }, { translucent: false, frost: "blur" }, { translucent: true, frost: "clear" }]) {
      writeUiPrefs(prefs);
      const { win } = open();
      const backdrop = backdropWindowOptions({ ...prefs, dark: false, supported });
      for (const [key, value] of Object.entries(backdrop)) expect(win.options[key]).toEqual(value);
    }
  });

  test("the transparency itself never depends on the preference, only the tint does", () => {
    writeUiPrefs({ translucent: true, frost: "blur" });
    const on = open().win.options;
    writeUiPrefs({ translucent: false, frost: "blur" });
    const off = open().win.options;
    expect(on.transparent).toBe(off.transparent);
    expect(on.hasShadow).toBe(off.hasShadow);
  });

  test("a dark system picks the dark backdrop", () => {
    electron.nativeTheme.shouldUseDarkColors = true;
    const { win } = open();
    expect(win.options.backgroundColor).toBe(backdropWindowOptions({ translucent: false, frost: "blur", dark: true, supported }).backgroundColor);
  });

  test("the renderer never throttles in the background, whatever the preference", () => {
    for (const translucent of [true, false]) {
      writeUiPrefs({ translucent, frost: "blur" });
      expect(open().win.options.webPreferences.backgroundThrottling).toBe(false);
    }
  });

  test("an unpackaged run wears the development icon", () => {
    const { win } = open();
    expect(path.basename(win.options.icon)).toMatch(/^icon(-dev)?\.png$/);
    expect(fs.existsSync(win.options.icon)).toBe(true);
  });
});

describe("the window joins the host registry", () => {
  test("it becomes the window in use and remembers its address", () => {
    const { win, manager } = open("http://127.0.0.1:42731/spool");
    expect(currentHost()).toBe(manager);
    expect(requireBrowserManager({ sender: win.webContents })).toBe(manager);
    expect(lastWindowUrl()).toBe("http://127.0.0.1:42731/spool");
  });

  test("closing it destroys its host and hands the registry to another window", () => {
    const first = open();
    const second = open();
    second.win.close();
    expect(second.manager.destroyed).toBe(1);
    expect(currentHost()).toBe(first.manager);
  });

  test("its title stays Telar's, whatever the page calls itself", () => {
    const { win } = open();
    const title = win.title;
    let prevented = false;
    win.setTitle("Some page");
    win.emit("page-title-updated", { preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(win.title).toBe(title);
  });
});

async function windowIdOf(win) {
  for (let tick = 0; tick < 50 && win.loaded.length === 0; tick += 1) await Promise.resolve();
  return new URL(win.loaded[0]).searchParams.get("w");
}

describe("each window carries its own id", () => {
  test("the first window is the main one and every other window gets a fresh id", async () => {
    const ids = await Promise.all([open(), open(), open()].map(({ win }) => windowIdOf(win)));
    expect(ids[0]).toBe("main");
    expect(new Set(ids).size).toBe(3);
  });

  test("the main id passes to the next window once the main window closes", async () => {
    const first = open();
    const second = open();
    first.win.close();
    expect(await windowIdOf(second.win)).not.toBe("main");
    expect(await windowIdOf(open().win)).toBe("main");
  });

  test("an address copied from another window does not copy its id", async () => {
    const main = open();
    expect(await windowIdOf(main.win)).toBe("main");
    const { win } = open(`${URL_}spool?w=main`);
    expect(await windowIdOf(win)).not.toBe("main");
    expect(new URL(win.loaded[0]).pathname).toBe("/spool");
  });
});

describe("a reload remounts the cockpit", () => {
  test("the native browser views hide before the renderer reloads", () => {
    const { win, manager } = open();
    win.webContents.emit("did-start-loading");
    expect(manager.hidden).toBe(1);
  });

  test("the page's claim on links is dropped until the remounted cockpit claims again", () => {
    const { win } = open();
    linkRouting.set(win.webContents, true);
    win.webContents.emit("did-start-loading");
    expect(linkRouting.claims(win.webContents)).toBe(false);
  });
});

describe("links out of the cockpit", () => {
  test("a popup to another site is denied and opened in the system browser", async () => {
    const { win } = open();
    expect(win.webContents.windowOpenHandler({ url: "https://example.com/" })).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(electron.shell.opened).toEqual(["https://example.com/"]);
  });

  test("when the page claims links, it gets them instead of the system browser", () => {
    const { win } = open();
    linkRouting.set(win.webContents, true);
    win.webContents.windowOpenHandler({ url: "https://example.com/" });
    expect(win.webContents.sent).toContainEqual({ channel: LINK_OPEN_CHANNEL, payload: { url: "https://example.com/" } });
    expect(electron.shell.opened).toEqual([]);
  });

  test("navigating the cockpit itself away is stopped and handed off the same way", () => {
    const { win } = open();
    let prevented = false;
    win.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "https://example.com/");
    expect(prevented).toBe(true);
    expect(electron.shell.opened).toEqual(["https://example.com/"]);
  });

  test("the cockpit's own pages stay in the window", () => {
    const { win } = open();
    expect(win.webContents.windowOpenHandler({ url: `${URL_}settings` })).toEqual({ action: "allow" });
    expect(electron.shell.opened).toEqual([]);
  });
});
