const { beforeEach, describe, expect, jest, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { electron, eventFrom, FakeBrowserWindow, FakeNotification, resetElectron, userData } = require("../../test/fake-electron");
const { createQuickComposer } = require("./quick-composer");
const { WIDTH } = require("./quick-composer-layout");
const { registerPrefsIpc } = require("./ipc-prefs");
const { applyTranslucency } = require("./appearance");

const CONTEXT = { app: "Notes", title: "Plan", selection: "two lines", permissions: { accessibility: true } };

let opened;
let quick;
let tick = null;
const ticker = (next) => {
  tick = next;
  return () => {
    tick = null;
  };
};
beforeEach(() => {
  resetElectron();
  fs.rmSync(path.join(userData, "quick-composer.json"), { force: true });
  opened = [];
  quick = createQuickComposer({ appUrl: "http://127.0.0.1:4000/", openRoute: (route) => opened.push(route), readContext: async () => CONTEXT, ticker });
});

const panel = () => FakeBrowserWindow.all[0];
const report = (height, composerTop) => electron.ipcMain.send("telar:quick-composer:layout", eventFrom(panel()), { height, composerTop });
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
    expect(lastOpen()).toEqual({ ...CONTEXT, fresh: false });
    expect(await electron.ipcMain.invoke("telar:quick-composer:context", eventFrom(win))).toEqual({ ...CONTEXT, fresh: false });
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
  test("is a card-sized pop-up panel that only main moves and sizes, with no click-through", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    expect(panel().options).toMatchObject({ type: "panel", transparent: true, hasShadow: false, resizable: false, width: WIDTH });
    expect(panel().onTop).toBe("pop-up-menu");
    expect(panel().ignoresMouse).toBeUndefined();
    expect(panel().bounds).toMatchObject({ x: Math.round((1440 - WIDTH) / 2), width: WIDTH });
  });

  test("sizes itself to what the page reports, the composer staying put, and only when it changed", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    let sets = 0;
    const setBounds = panel().setBounds.bind(panel());
    panel().setBounds = (bounds, animate) => {
      sets += 1;
      expect(animate).toBe(false);
      setBounds(bounds);
    };
    report(200, 24);
    const composerAt = panel().bounds.y + 24;
    report(520, 344);
    expect(panel().bounds.height).toBe(520);
    expect(panel().bounds.y + 344).toBe(composerAt);
    report(521, 345);
    expect(sets).toBe(2);
    expect(panel().webContents.sent.at(-1)).toMatchObject({ channel: "telar:quick-composer:room", payload: { above: expect.any(Number), below: expect.any(Number) } });
  });

  test("follows the page down as well as up, and a reopen restores the spot but never the old height", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    report(200, 24);
    const composerAt = panel().bounds.y + 24;
    report(560, 344);
    report(200, 24);
    expect(panel().bounds).toMatchObject({ height: 200, y: composerAt - 24 });
    report(560, 344);
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().bounds.height).toBe(260);
    expect(panel().bounds.y + 24).toBe(composerAt);
  });

  test("keeps its window clear when the appearance retints every window", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    applyTranslucency(true, "blur");
    expect(panel().vibrancy).toBeUndefined();
    expect(panel().backgroundColor).toBeUndefined();
  });

  test("a native move re-anchors it on the display it landed on", async () => {
    electron.screen.displays = [electron.screen.displays[0], { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
    quick.bind("Alt+Space");
    await press("Alt+Space");
    report(200, 24);
    panel().setPosition(3000, 500);
    panel().emit("moved");
    expect(panel().bounds.x).toBe(1440 + 1920 - WIDTH);
  });

  test("the editor's fallback drag follows the cursor from main until the page lets go", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    electron.ipcMain.send("telar:quick-composer:drag", eventFrom(panel()), { phase: "start", offsetX: 30, offsetY: 12 });
    electron.screen.cursor = { x: 2000, y: 300 };
    tick();
    expect(panel().getPosition()).toEqual([1970, 288]);
    electron.ipcMain.send("telar:quick-composer:drag", eventFrom(panel()), { phase: "end" });
    expect(tick).toBeNull();
  });

  test("reopened within a minute it comes back where it was on that display; after a minute, or if that display is gone, it starts fresh", async () => {
    jest.useFakeTimers();
    try {
      electron.screen.displays = [electron.screen.displays[0], { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
      electron.screen.cursor = { x: 2000, y: 500 };
      quick.bind("Alt+Space");
      await press("Alt+Space");
      report(200, 24);
      panel().setPosition(1600, 300);
      panel().emit("moved");
      await press("Alt+Space");
      electron.screen.cursor = { x: 10, y: 10 };
      jest.advanceTimersByTime(59_000);
      await press("Alt+Space");
      expect(panel().bounds).toMatchObject({ x: 1600, y: 300 });
      expect(lastOpen()).toMatchObject({ fresh: false });
      await press("Alt+Space");
      electron.screen.displays = [electron.screen.displays[0]];
      await press("Alt+Space");
      expect(panel().bounds.x).toBe(Math.round((1440 - WIDTH) / 2));
      await press("Alt+Space");
      jest.advanceTimersByTime(60_000);
      await press("Alt+Space");
      expect(lastOpen()).toMatchObject({ fresh: true });
    } finally {
      jest.useRealTimers();
    }
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
