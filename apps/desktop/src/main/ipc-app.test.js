const { beforeEach, describe, expect, test } = require("bun:test");
const { electron, eventFrom, FakeBrowserWindow, FakeWebContents, resetElectron } = require("../../test/fake-electron");
const { registerAppIpc } = require("./ipc-app");
const { rememberWindowUrl } = require("./browser-hosts");
const { linkRouting } = require("./window-links");

let opened;
let tested;
beforeEach(() => {
  resetElectron();
  opened = [];
  tested = [];
  registerAppIpc({ createWindow: (url) => opened.push(url), testNotification: (sounds) => (tested.push(sounds), { ok: true }) });
});

function cockpitAt(url) {
  const win = new FakeBrowserWindow();
  win.webContents.url = url;
  return win;
}

describe("telar:app:open-window", () => {
  test("a path is resolved against the asking window's own address", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/projects/p1");
    expect(await electron.ipcMain.invoke("telar:app:open-window", eventFrom(win), { path: "/spool" })).toEqual({ ok: true });
    expect(opened).toEqual(["http://127.0.0.1:42731/spool"]);
  });

  test("a window with no address yet falls back to the last cockpit address", async () => {
    rememberWindowUrl("http://127.0.0.1:42731/");
    const win = cockpitAt("");
    await electron.ipcMain.invoke("telar:app:open-window", eventFrom(win), { path: "/spool" });
    expect(opened).toEqual(["http://127.0.0.1:42731/spool"]);
  });

  test("a target outside Telar is refused and opens nothing", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    const result = await electron.ipcMain.invoke("telar:app:open-window", eventFrom(win), { path: "https://example.com/" });
    expect(result.ok).toBe(false);
    expect(opened).toEqual([]);
  });

  test("a subframe or a renderer that is no window may not ask", () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    expect(() => electron.ipcMain.invoke("telar:app:open-window", eventFrom(win, { frame: { name: "sub" } }), { path: "/spool" })).toThrow("Only a Telar window");
    expect(() => electron.ipcMain.invoke("telar:app:open-window", { sender: new FakeWebContents(), senderFrame: {} }, { path: "/spool" })).toThrow("Only a Telar window");
    expect(opened).toEqual([]);
  });
});

describe("telar:notifications:test", () => {
  test("sends the chosen set to the notifier", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    expect(await electron.ipcMain.invoke("telar:notifications:test", eventFrom(win), { sounds: "felt" })).toEqual({ ok: true });
    expect(tested).toEqual(["felt"]);
  });
});

describe("telar:links:set-routing", () => {
  test("the page's top frame claims its links, and releases them", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    await electron.ipcMain.invoke("telar:links:set-routing", eventFrom(win), { on: true });
    expect(linkRouting.claims(win.webContents)).toBe(true);
    await electron.ipcMain.invoke("telar:links:set-routing", eventFrom(win), { on: "yes" });
    expect(linkRouting.claims(win.webContents)).toBe(false);
  });

  test("a subframe cannot claim them", () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    expect(() => electron.ipcMain.invoke("telar:links:set-routing", eventFrom(win, { frame: { name: "sub" } }), { on: true })).toThrow();
    expect(linkRouting.claims(win.webContents)).toBe(false);
  });
});

describe("telar:app:unread", () => {
  test("the Dock badge shows the count and clears at zero", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(win), { count: 3 });
    expect(electron.app.badgeCount).toBe(3);
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(win), { count: 0 });
    expect(electron.app.badgeCount).toBe(0);
  });

  test("a malformed count clears the badge", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(win), { count: 2 });
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(win), { count: "7" });
    expect(electron.app.badgeCount).toBe(0);
  });

  test("with two windows the larger count shows, and a closed window's count goes with it", async () => {
    const first = cockpitAt("http://127.0.0.1:42731/");
    const second = cockpitAt("http://127.0.0.1:42731/");
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(first), { count: 1 });
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(second), { count: 2 });
    expect(electron.app.badgeCount).toBe(2);
    second.webContents.emit("destroyed");
    expect(electron.app.badgeCount).toBe(1);
  });

  test("the open session counts only while its window is not focused", async () => {
    const win = cockpitAt("http://127.0.0.1:42731/");
    win.focus();
    await electron.ipcMain.invoke("telar:app:unread", eventFrom(win), { count: 1, openUnread: true });
    expect(electron.app.badgeCount).toBe(1);
    FakeBrowserWindow.focused = null;
    electron.app.emit("browser-window-blur");
    expect(electron.app.badgeCount).toBe(2);
    win.focus();
    electron.app.emit("browser-window-focus");
    expect(electron.app.badgeCount).toBe(1);
  });
});
