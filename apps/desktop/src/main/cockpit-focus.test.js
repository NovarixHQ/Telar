const { afterEach, expect, test } = require("bun:test");
const { FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const hosts = require("./browser-hosts");
const { cockpitFocus } = require("./cockpit-focus");

afterEach(resetElectron);

test("a focused cockpit window reports its route; focus elsewhere reports none", () => {
  const cockpit = new FakeBrowserWindow();
  cockpit.webContents.url = "http://127.0.0.1:42731/projects/p1/sessions/s1";
  const manager = { window: cockpit };
  hosts.addHost(cockpit, manager);

  cockpit.focus();
  expect(cockpitFocus()).toEqual({ focused: true, viewingPath: "/projects/p1/sessions/s1" });

  new FakeBrowserWindow().focus();
  expect(cockpitFocus()).toEqual({ focused: false, viewingPath: null });
  hosts.removeHost(manager);
});
