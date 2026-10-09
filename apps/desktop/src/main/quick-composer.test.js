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
const drag = (win, dx, dy) => {
  electron.ipcMain.send("telar:quick-composer:drag", eventFrom(win), { phase: "start" });
  electron.ipcMain.send("telar:quick-composer:drag", eventFrom(win), { phase: "move", dx: dx / 2, dy: dy / 2 });
  electron.ipcMain.send("telar:quick-composer:drag", eventFrom(win), { phase: "move", dx, dy });
  electron.ipcMain.send("telar:quick-composer:drag", eventFrom(win), { phase: "end" });
};
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
    expect(win.webContents.sent[0]).toEqual({ channel: "telar:quick-composer:open", payload: CONTEXT });
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

describe("the window", () => {
  test("is transparent and movable, so only the composer's own card shows", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    expect(panel().options).toMatchObject({ transparent: true, movable: true, hasShadow: false, backgroundColor: "#00000000" });
  });

  test("opens where it was last dragged on that display", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    expect(panel().getPosition()).toEqual([380, 200]);
    drag(panel(), -260, 400);
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().getPosition()).toEqual([120, 600]);
  });

  test("dragging moves it by the pointer's travel from where the drag began", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    electron.ipcMain.send("telar:quick-composer:drag", eventFrom(panel()), { phase: "start" });
    electron.ipcMain.send("telar:quick-composer:drag", eventFrom(panel()), { phase: "move", dx: 10, dy: 5 });
    electron.ipcMain.send("telar:quick-composer:drag", eventFrom(panel()), { phase: "move", dx: 30, dy: -20 });
    expect(panel().getPosition()).toEqual([410, 180]);
    electron.ipcMain.send("telar:quick-composer:drag", eventFrom(new FakeBrowserWindow()), { phase: "move", dx: 500, dy: 500 });
    expect(panel().getPosition()).toEqual([410, 180]);
  });

  test("a spot on another display does not move it there", async () => {
    electron.screen.displays = [electron.screen.displays[0], { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
    quick.bind("Alt+Space");
    await press("Alt+Space");
    drag(panel(), 1620, 100);
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().getPosition()).toEqual([380, 200]);
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
    expect(panel().webContents.sent.at(-1)).toEqual({ channel: "telar:quick-composer:permissions", payload: { accessibility: true, screen: true } });
  });

  test("Screen Recording asks to capture first, so the app is listed in the pane it opens", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    const asked = [];
    const { getSources } = electron.desktopCapturer;
    electron.desktopCapturer.getSources = async () => (asked.push([...electron.shell.opened]), []);
    await electron.ipcMain.invoke("telar:quick-composer:open-settings", eventFrom(panel()), "screen");
    electron.desktopCapturer.getSources = getSources;
    expect(asked).toEqual([[]]);
    expect(electron.shell.opened).toEqual(["x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]);
  });

  test("each button opens its own pane, and only from the panel", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await electron.ipcMain.invoke("telar:quick-composer:open-settings", eventFrom(panel()), "screen");
    await electron.ipcMain.invoke("telar:quick-composer:open-settings", eventFrom(panel()), "accessibility");
    await electron.ipcMain.invoke("telar:quick-composer:open-settings", eventFrom(new FakeBrowserWindow()), "screen");
    expect(electron.shell.opened).toEqual([
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    ]);
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
