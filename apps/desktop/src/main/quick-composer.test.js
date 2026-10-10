const { beforeEach, describe, expect, jest, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { electron, eventFrom, FakeBrowserWindow, FakeNotification, resetElectron, userData } = require("../../test/fake-electron");
const { createQuickComposer } = require("./quick-composer");
const { HEIGHTS, WIDTH } = require("./quick-composer-layout");
const { registerPrefsIpc } = require("./ipc-prefs");
const { applyTranslucency } = require("./appearance");

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
  test("opens compact, low on the cursor's display, switches size in one unanimated step, and tells the page once it has", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    const low = Math.round(900 - 875 * 0.22);
    expect(panel().options).toMatchObject({ type: "panel", transparent: true, hasShadow: false, resizable: false, width: WIDTH });
    expect(panel().onTop).toBe("pop-up-menu");
    expect(panel().bounds).toEqual({ x: Math.round((1440 - WIDTH) / 2), y: low - HEIGHTS.compact, width: WIDTH, height: HEIGHTS.compact });
    const sets = [];
    const setBounds = panel().setBounds.bind(panel());
    panel().setBounds = (bounds, animate) => {
      sets.push(animate);
      setBounds(bounds);
    };
    expect(electron.ipcMain.listeners.has("telar:quick-composer:layout")).toBe(false);
    electron.ipcMain.send("telar:quick-composer:mode", eventFrom(panel()), "expanded");
    expect(panel().bounds).toMatchObject({ y: low - HEIGHTS.expanded, height: HEIGHTS.expanded });
    electron.ipcMain.send("telar:quick-composer:mode", eventFrom(panel()), "expanded");
    electron.ipcMain.send("telar:quick-composer:mode", eventFrom(panel()), "huge");
    electron.ipcMain.send("telar:quick-composer:mode", eventFrom(new FakeBrowserWindow()), "compact");
    expect(sets).toEqual([false]);
    expect(panel().webContents.sent.filter((message) => message.channel === "telar:quick-composer:resized").map((message) => message.payload)).toEqual(["expanded", "expanded", "expanded"]);
  });

  test("a native drag is never fought: moving sets no bounds, keeps the spot as dropped, and tells the page to take focus back", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    let sets = 0;
    const setBounds = panel().setBounds.bind(panel());
    panel().setBounds = (bounds, animate) => {
      sets += 1;
      setBounds(bounds, animate);
    };
    panel().setPosition(300, 120);
    panel().emit("moved");
    expect(sets).toBe(0);
    expect(panel().getPosition()).toEqual([300, 120]);
    expect(panel().webContents.sent.at(-1)).toEqual({ channel: "telar:quick-composer:moved", payload: undefined });
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().bounds).toMatchObject({ x: 300, y: 120 });
  });

  test("when the panel becomes key, the page is told to focus the editor if nothing else has focus", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    panel().focus();
    expect(panel().webContents.sent.some((message) => message.channel === "telar:quick-composer:moved" && message.payload?.ifIdle)).toBe(true);
  });

  test("a spot dropped off the display is pulled back inside on the next open", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    panel().setPosition(5000, 9000);
    panel().emit("moved");
    await press("Alt+Space");
    await press("Alt+Space");
    expect(panel().bounds).toEqual({ x: 1440 - WIDTH, y: 900 - HEIGHTS.compact, width: WIDTH, height: HEIGHTS.compact });
  });

  test("reopened within a minute it comes back where it was, at the size it was; after a minute it starts fresh and compact", async () => {
    jest.useFakeTimers();
    try {
      quick.bind("Alt+Space");
      await press("Alt+Space");
      electron.ipcMain.send("telar:quick-composer:mode", eventFrom(panel()), "expanded");
      panel().setPosition(200, 100);
      panel().emit("moved");
      await press("Alt+Space");
      jest.advanceTimersByTime(59_000);
      await press("Alt+Space");
      expect(panel().bounds).toMatchObject({ x: 200, y: 100, height: HEIGHTS.expanded });
      expect(lastOpen()).toMatchObject({ fresh: false });
      await press("Alt+Space");
      jest.advanceTimersByTime(60_000);
      await press("Alt+Space");
      expect(lastOpen()).toMatchObject({ fresh: true });
      expect(panel().bounds).toMatchObject({ x: Math.round((1440 - WIDTH) / 2), height: HEIGHTS.compact });
    } finally {
      jest.useRealTimers();
    }
  });

  test("closing it gives focus back to the Telar window that had it, and asks its page to restore the caret", async () => {
    const main = new FakeBrowserWindow();
    main.focus();
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await electron.ipcMain.invoke("telar:quick-composer:close", eventFrom(panel()));
    expect(FakeBrowserWindow.focused).toBe(main);
    expect(main.webContents.sent.at(-1)).toEqual({ channel: "telar:focus:restore", payload: undefined });
    expect(electron.app.hidden ?? 0).toBe(0);
  });

  test("closing it when another app was in front hands focus back to that app, and a blur gives nothing back", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    await electron.ipcMain.invoke("telar:quick-composer:close", eventFrom(panel()));
    const handedBack = process.platform === "darwin" ? 1 : 0;
    expect(electron.app.hidden).toBe(handedBack);
    const main = new FakeBrowserWindow();
    main.focus();
    await press("Alt+Space");
    panel().emit("blur");
    expect(main.webContents.sent.some((message) => message.channel === "telar:focus:restore")).toBe(false);
    expect(electron.app.hidden).toBe(handedBack);
  });

  test("keeps its window clear when the appearance retints every window", async () => {
    quick.bind("Alt+Space");
    await press("Alt+Space");
    applyTranslucency(true, "blur");
    expect(panel().vibrancy).toBeUndefined();
    expect(panel().backgroundColor).toBeUndefined();
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
