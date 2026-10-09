const { beforeEach, describe, expect, jest, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { electron, eventFrom, FakeBrowserWindow, FakeNotification, resetElectron, userData } = require("../../test/fake-electron");
const { createQuickComposer } = require("./quick-composer");
const { registerPrefsIpc } = require("./ipc-prefs");

const CONTEXT = { app: "Notes", title: "Plan", selection: "two lines", permissions: { accessibility: true } };

let opened;
let quick;
beforeEach(() => {
  resetElectron();
  fs.rmSync(path.join(userData, "quick-composer.json"), { force: true });
  opened = [];
  quick = createQuickComposer({ appUrl: "http://127.0.0.1:4000/", openRoute: (route) => opened.push(route), readContext: async () => CONTEXT });
});

const panel = () => FakeBrowserWindow.all[0];
const lastOpen = () => panel().webContents.sent.filter((message) => message.channel === "telar:quick-composer:open").at(-1)?.payload;
const press = async (chord) => {
  electron.globalShortcut.press(chord);
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
};

describe("the shortcut", () => {
  test("claims the keymap's chord system-wide and opens the panel over the app in front", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    const win = panel();
    expect(win.options).toMatchObject({ type: "panel", frame: false, alwaysOnTop: true, skipTaskbar: true });
    expect(win.loaded).toEqual(["http://127.0.0.1:4000/surface/quick"]);
    expect(win.isVisible()).toBe(true);
    expect(win.webContents.sent[0]).toEqual({ channel: "telar:quick-composer:open", payload: { ...CONTEXT, spot: null, area: { width: 1440, height: 875 }, fresh: false } });
    expect(await electron.ipcMain.invoke("telar:quick-composer:context", eventFrom(win))).toEqual({ ...CONTEXT, spot: null, area: { width: 1440, height: 875 }, fresh: false });
  });

  test("pressing it again hides the panel", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().isVisible()).toBe(false);
  });

  test("rebinding releases the old chord and claims the new one", () => {
    quick.bind("Alt+Space");
    quick.bind("CommandOrControl+Shift+Space");
    expect([...electron.globalShortcut.registered.keys()]).toEqual(["CommandOrControl+Shift+Space"]);
    quick.bind("");
    expect(electron.globalShortcut.registered.size).toBe(0);
  });

  test("follows a rebind made in Keybindings", async () => {
    registerPrefsIpc({ onKeymap: (keymap) => quick.bind(keymap["quick-composer"]) });
    quick.bind("Alt+Space");
    await electron.ipcMain.invoke("telar:keybindings:set", {}, { "quick-composer": "Ctrl+Alt+K" });
    expect([...electron.globalShortcut.registered.keys()]).toEqual(["CommandOrControl+Alt+K"]);
    fs.rmSync(path.join(userData, "keybindings.json"), { force: true });
  });

  test("is let go while a chord is being recorded, and claimed again after", () => {
    quick.bind("Alt+Space");
    quick.suspend(true);
    expect(electron.globalShortcut.isRegistered("Alt+Space")).toBe(false);
    quick.suspend(false);
    expect(electron.globalShortcut.isRegistered("Alt+Space")).toBe(true);
  });

  test("asks for the permissions only the first time it opens", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await press("Alt+Space");
    await press("Alt+Space");
    expect(electron.systemPreferences.prompted).toBe(1);
  });
});

describe("the window", () => {
  test("is a transparent overlay on the cursor's display that lets clicks through until the card asks for them", async () => {
    electron.screen.displays = [electron.screen.displays[0], { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
    electron.screen.cursor = { x: 2000, y: 500 };
    quick.bind("Alt+Space");
    await press("Alt+Space");
    expect(panel().options).toMatchObject({ transparent: true, hasShadow: false, backgroundColor: "#00000000", resizable: false });
    expect(panel().bounds).toEqual({ x: 1440, y: 0, width: 1920, height: 1080 });
    expect(panel().ignoresMouse).toEqual({ forward: true });
    electron.ipcMain.send("telar:quick-composer:interactive", eventFrom(panel()), true);
    expect(panel().ignoresMouse).toBe(false);
    electron.ipcMain.send("telar:quick-composer:interactive", eventFrom(panel()), false);
    expect(panel().ignoresMouse).toEqual({ forward: true });
  });

  test("has no resize or drag channel: the page never sizes or moves the window", () => {
    expect(electron.ipcMain.listeners.has("telar:quick-composer:resize")).toBe(false);
    expect(electron.ipcMain.listeners.has("telar:quick-composer:drag")).toBe(false);
  });

  test("remembers the card's spot and asks for no reset when reopened within a minute, then forgets both", async () => {
    jest.useFakeTimers();
    try {
      quick.bind("Alt+Space");
      await press("Alt+Space");
      electron.ipcMain.send("telar:quick-composer:moved", eventFrom(panel()), { x: 120, y: 300 });
      await press("Alt+Space");
      jest.advanceTimersByTime(59_000);
      await press("Alt+Space");
      expect(lastOpen()).toMatchObject({ spot: { x: 120, y: 300 }, fresh: false });
      await press("Alt+Space");
      jest.advanceTimersByTime(60_000);
      await press("Alt+Space");
      expect(lastOpen()).toMatchObject({ spot: null, fresh: true });
      await press("Alt+Space");
      await press("Alt+Space");
      expect(lastOpen()).toMatchObject({ spot: null, fresh: false });
    } finally {
      jest.useRealTimers();
    }
  });

  test("hands the page the card's spot saved for that display", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    expect(panel().webContents.sent[0].payload.spot).toBeNull();
    electron.ipcMain.send("telar:quick-composer:moved", eventFrom(panel()), { x: 120.4, y: 300 });
    electron.ipcMain.send("telar:quick-composer:moved", eventFrom(new FakeBrowserWindow()), { x: 9, y: 9 });
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().webContents.sent.find((message) => message.channel === "telar:quick-composer:open" && message.payload.spot)?.payload.spot).toEqual({ x: 120, y: 300 });
  });

  test("a lost or failed page is logged and reloaded once, not forever", () => {
    const lines = [];
    resetElectron();
    quick = createQuickComposer({ appUrl: "http://127.0.0.1:4000/", openRoute: () => {}, readContext: async () => CONTEXT, log: (line) => lines.push(line) });
    const contents = panel().webContents;
    contents.emit("render-process-gone", {}, { reason: "oom" });
    contents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "http://127.0.0.1:4000/surface/quick", true);
    expect(contents.reloads).toBe(1);
    expect(lines).toEqual(["quick composer page failed: renderer gone (oom)", "quick composer page failed: load failed -6 ERR_FILE_NOT_FOUND"]);
    electron.ipcMain.send("telar:quick-composer:failed", eventFrom(panel()), "TypeError: boom");
    expect(lines.at(-1)).toBe("quick composer page failed: page error TypeError: boom");
    expect(contents.reloads).toBe(1);
  });

  test("a drag that crosses onto another display moves the overlay there and keeps the card under the cursor", async () => {
    electron.screen.displays = [electron.screen.displays[0], { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
    quick.bind("Alt+Space");
    await press("Alt+Space");
    electron.screen.cursor = { x: 2000, y: 500 };
    electron.ipcMain.send("telar:quick-composer:cross", eventFrom(panel()), { grabX: 40, grabY: 30 });
    expect(panel().bounds).toEqual({ x: 1440, y: 0, width: 1920, height: 1080 });
    expect(panel().webContents.sent.at(-1)).toEqual({ channel: "telar:quick-composer:place", payload: { spot: { x: 520, y: 470 }, area: { width: 1920, height: 1080 } } });
  });

  test("within the minute it reopens on the remembered display, and on the primary one if that display is gone", async () => {
    electron.screen.displays = [electron.screen.displays[0], { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
    electron.screen.cursor = { x: 2000, y: 500 };
    quick.bind("Alt+Space");
    await press("Alt+Space");
    electron.ipcMain.send("telar:quick-composer:moved", eventFrom(panel()), { x: 800, y: 200 });
    await press("Alt+Space");
    electron.screen.cursor = { x: 10, y: 10 };
    await press("Alt+Space");
    expect(panel().bounds).toEqual({ x: 1440, y: 0, width: 1920, height: 1080 });
    expect(lastOpen()).toMatchObject({ spot: { x: 800, y: 200 }, area: { width: 1920, height: 1080 } });
    await press("Alt+Space");
    electron.screen.displays = [electron.screen.displays[0]];
    await press("Alt+Space");
    expect(panel().bounds).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
    expect(lastOpen().spot).toBeNull();
  });

  test("clicking anywhere else hides it", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    panel().emit("blur");
    expect(panel().isVisible()).toBe(false);
  });

  test("a file picker it opened does not hide it, and the next blur after it closes does", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    electron.ipcMain.send("telar:quick-composer:hold", eventFrom(panel()));
    panel().emit("blur");
    expect(panel().isVisible()).toBe(true);
    panel().focus();
    panel().emit("blur");
    expect(panel().isVisible()).toBe(false);
  });
});

describe("the permissions", () => {
  test("are checked again each time the panel takes focus", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    Object.assign(electron.systemPreferences, { trusted: true, screen: "granted" });
    panel().focus();
    expect(panel().webContents.sent.at(-1)).toEqual({ channel: "telar:quick-composer:permissions", payload: { accessibility: true } });
  });

  test("the button opens the Accessibility pane, and only from the panel", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await electron.ipcMain.invoke("telar:quick-composer:open-settings", eventFrom(panel()), "accessibility");
    await electron.ipcMain.invoke("telar:quick-composer:open-settings", eventFrom(new FakeBrowserWindow()), "accessibility");
    expect(electron.shell.opened).toEqual(["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]);
  });
});

describe("sending", () => {
  test("Enter hides the panel and posts a notice that opens the session", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await electron.ipcMain.invoke("telar:quick-composer:sent", eventFrom(panel()), { route: "/projects/p/sessions/s", title: "Review this PR", detail: "Telar", open: false });
    expect(panel().isVisible()).toBe(false);
    const [notice] = FakeNotification.shown;
    expect(notice.options).toMatchObject({ title: "Started in Telar", body: "“Review this PR” · Telar" });
    expect(opened).toEqual([]);
    notice.emit("click");
    expect(opened).toEqual(["/projects/p/sessions/s"]);
    expect(electron.app.focused).toBe(1);
  });

  test("⌘Enter opens Telar on the session without a notice", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await electron.ipcMain.invoke("telar:quick-composer:sent", eventFrom(panel()), { route: "/projects/p/sessions/s", title: "x", detail: "", open: true });
    expect(opened).toEqual(["/projects/p/sessions/s"]);
    expect(FakeNotification.shown).toEqual([]);
  });

  test("another window cannot speak for the panel", async () => {
    const other = new FakeBrowserWindow();
    await electron.ipcMain.invoke("telar:quick-composer:sent", eventFrom(other), { route: "/x", open: true });
    expect(opened).toEqual([]);
    expect(await electron.ipcMain.invoke("telar:quick-composer:context", eventFrom(other))).toBeNull();
  });
});
