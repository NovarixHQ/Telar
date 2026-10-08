const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const { electron, eventFrom, FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const { buildApplicationMenu, followFocusedWindow, setBrowserChordScope } = require("./app-menu");
const { addHost, removeHost } = require("./browser-hosts");
const { registerPrefsIpc } = require("./ipc-prefs");

afterEach(() => {
  for (const win of FakeBrowserWindow.getAllWindows()) win.close();
  resetElectron();
});

const windowMenu = () => electron.Menu.current.find((menu) => menu.role === "window");

function menuItem(label, items = electron.Menu.current) {
  for (const item of items) {
    if (item.label === label) return item;
    const found = Array.isArray(item.submenu) ? menuItem(label, item.submenu) : null;
    if (found) return found;
  }
  return null;
}

test("the Window menu offers to float the browser on top, with its shortcut", () => {
  buildApplicationMenu();
  const item = windowMenu().submenu.find((entry) => entry.label === "Float browser on top");
  expect(item.accelerator).toBe("CommandOrControl+Alt+P");

  const win = new FakeBrowserWindow();
  item.click(null, win);
  expect(win.webContents.sent).toContainEqual({ channel: "telar:command-keys:invoke", payload: "float-browser" });
});

test("it keeps the system's window items", () => {
  buildApplicationMenu();
  const roles = windowMenu().submenu.map((entry) => entry.role).filter(Boolean);
  expect(roles).toEqual(expect.arrayContaining(["minimize", "zoom"]));
});

describe("each window keeps its own shortcut state, and the menu follows the focused one", () => {
  let a;
  let b;

  beforeEach(() => {
    registerPrefsIpc();
    followFocusedWindow();
    a = new FakeBrowserWindow();
    b = new FakeBrowserWindow();
    focus(a);
  });

  function focus(win) {
    FakeBrowserWindow.focused = win;
    electron.app.emit("browser-window-focus", {}, win);
  }
  const capture = (win, on) => electron.ipcMain.invoke("telar:keybindings:capture", eventFrom(win), on);
  const scope = (win, chords) => electron.ipcMain.invoke("telar:keybindings:scope", eventFrom(win), chords);
  const newConversation = () => menuItem("New session");

  test("recording a shortcut in one window leaves the other's shortcuts working", () => {
    expect(capture(b, true)).toBe(true);
    expect(newConversation()).toMatchObject({ accelerator: "CommandOrControl+N", enabled: true });

    focus(b);
    expect(newConversation().accelerator).toBeUndefined();
    expect(newConversation().enabled).toBe(false);

    focus(a);
    expect(newConversation()).toMatchObject({ accelerator: "CommandOrControl+N", enabled: true });
  });

  test("a chord one window's page claims stays an accelerator in the other", () => {
    expect(scope(b, ["CommandOrControl+N"])).toEqual(["CommandOrControl+N"]);
    expect(newConversation().accelerator).toBe("CommandOrControl+N");

    focus(b);
    expect(newConversation().accelerator).toBeUndefined();
  });

  test("a reload clears only that window's capture and claims", () => {
    capture(a, true);
    scope(b, ["CommandOrControl+N"]);
    a.webContents.emit("did-start-loading");
    expect(newConversation()).toMatchObject({ accelerator: "CommandOrControl+N", enabled: true });

    focus(b);
    expect(newConversation().accelerator).toBeUndefined();
  });

  test("closing a window drops its state", () => {
    focus(b);
    capture(b, true);
    expect(newConversation().enabled).toBe(false);

    FakeBrowserWindow.focused = null;
    b.close();
    expect(newConversation()).toMatchObject({ accelerator: "CommandOrControl+N", enabled: true });
  });

  test("a browser tab's claim takes the accelerator only while its own window is focused", () => {
    const manager = { window: b, windowOfSender: (sender) => (sender === b.webContents ? b : null) };
    addHost(b, manager);
    setBrowserChordScope(manager, ["CommandOrControl+1"]);
    expect(menuItem("Jump to 1").accelerator).toBe("CommandOrControl+1");

    focus(b);
    expect(menuItem("Jump to 1").accelerator).toBeUndefined();
    removeHost(manager);
  });
});
