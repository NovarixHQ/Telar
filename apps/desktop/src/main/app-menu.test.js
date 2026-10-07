const { afterEach, expect, test } = require("bun:test");
const { electron, FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const { buildApplicationMenu } = require("./app-menu");

afterEach(() => resetElectron());

const windowMenu = () => electron.Menu.current.find((menu) => menu.role === "window");

test("the Window menu offers to float the browser on top, with its shortcut", () => {
  buildApplicationMenu();
  const item = windowMenu().submenu.find((entry) => entry.label === "Float Browser on Top");
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
