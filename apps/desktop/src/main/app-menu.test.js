const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const { electron, eventFrom, FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const { buildApplicationMenu, followFocusedWindow, forwardPageCommand, setBrowserChordScope } = require("./app-menu");
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

test("the dictation chord pressed on a browser page reaches the cockpit, and other chords stay with the page", () => {
  const win = new FakeBrowserWindow();
  const press = (key, code) => forwardPageCommand(win, { type: "keyDown", key, code, meta: true, control: false, alt: false, shift: false });
  expect(press("d", "KeyD")).toBe(true);
  expect(win.webContents.sent).toEqual([{ channel: "telar:command-keys:invoke", payload: "toggle-dictation" }]);
  expect(press("s", "KeyS")).toBe(false);
  expect(press("k", "KeyK")).toBe(false);
  expect(win.webContents.sent).toHaveLength(1);
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

test("⌘W is the Panel menu's Close panel tab, sent to the cockpit, and no other item claims ⌘W", () => {
  buildApplicationMenu();
  const item = menuItem("Close panel tab");
  expect(item.accelerator).toBe("CommandOrControl+W");
  const win = new FakeBrowserWindow();
  item.click(null, win);
  expect(win.webContents.sent).toContainEqual({ channel: "telar:command-keys:invoke", payload: "close-panel-tab" });
  const all = (items) => items.flatMap((entry) => [entry, ...(Array.isArray(entry.submenu) ? all(entry.submenu) : [])]);
  const closers = all(electron.Menu.current).filter((entry) => entry.accelerator === "CommandOrControl+W");
  expect(closers).toEqual([item]);
});

test("the Panel menu's Select tab carries ⌃⌘1…9", () => {
  buildApplicationMenu();
  const select = menuItem("Select tab");
  expect(select.submenu.map((entry) => entry.accelerator)).toEqual(Array.from({ length: 9 }, (_, index) => `CommandOrControl+Control+${index + 1}`));
  expect(select.submenu.at(-1).label).toBe("Last panel tab");
});
