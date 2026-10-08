const { BrowserWindow } = require("electron");
const { routeOf } = require("./desktop-notifications");
const { browserManagers } = require("./browser-hosts");

function cockpitFocus() {
  const focused = BrowserWindow.getFocusedWindow();
  const cockpit = focused && [...browserManagers].some((manager) => manager.window === focused);
  return { focused: Boolean(cockpit), viewingPath: cockpit ? routeOf(focused.webContents.getURL()) : null };
}

module.exports = { cockpitFocus };
