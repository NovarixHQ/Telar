const { beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { electron, eventFrom, FakeBrowserWindow, FakeNotification, resetElectron, userData } = require("../../test/fake-electron");
const { createQuickComposer } = require("./quick-composer");
const { registerPrefsIpc } = require("./ipc-prefs");

const CONTEXT = { app: "Notes", title: "Plan", selection: "two lines", screenshot: null, permissions: { accessibility: true, screen: false } };

let opened;
let quick;
beforeEach(() => {
  resetElectron();
  fs.rmSync(path.join(userData, "quick-composer.json"), { force: true });
  opened = [];
  quick = createQuickComposer({ appUrl: "http://127.0.0.1:4000/", openRoute: (route) => opened.push(route), readContext: async () => CONTEXT });
});

const panel = () => FakeBrowserWindow.all[0];
const press = async (chord) => {
  electron.globalShortcut.press(chord);
  await new Promise((resolve) => setImmediate(resolve));
};

describe("the shortcut", () => {
  test("claims the keymap's chord system-wide and opens the panel over the app in front", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    const win = panel();
    expect(win.options).toMatchObject({ type: "panel", frame: false, alwaysOnTop: true, skipTaskbar: true });
    expect(win.loaded).toEqual(["http://127.0.0.1:4000/surface/quick"]);
    expect(win.isVisible()).toBe(true);
    expect(win.webContents.sent).toEqual([{ channel: "telar:quick-composer:open", payload: CONTEXT }]);
    expect(await electron.ipcMain.invoke("telar:quick-composer:context", eventFrom(win))).toEqual(CONTEXT);
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
