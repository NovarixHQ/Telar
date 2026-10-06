const { ipcMain, app, BrowserWindow } = require("electron");
const { windowVisible } = require("./window-visibility");
const { windowTargetUrl } = require("./window-target");
const { lastWindowUrl } = require("./browser-hosts");
const { linkRouting } = require("./window-links");
const { lastRunawayNotice, processMetricsReader } = require("./renderer-watch");
const { lastEngineRestart } = require("./engine-child");

function registerAppIpc({ createWindow, testNotification }) {
  const unreadByWindow = new Map();
  const showUnread = () => {
    const counts = [...unreadByWindow].map(([sender, { count, openUnread }]) =>
      count + (openUnread && !BrowserWindow.fromWebContents(sender)?.isFocused() ? 1 : 0));
    app.setBadgeCount(Math.max(0, ...counts));
  };
  app.on("browser-window-focus", showUnread);
  app.on("browser-window-blur", showUnread);

  ipcMain.handle("telar:app:relaunch", () => {
    app.relaunch();
    app.quit();
  });

  ipcMain.handle("telar:app:unread", (event, input) => {
    const count = Number.isSafeInteger(input?.count) && input.count > 0 ? input.count : 0;
    if (!unreadByWindow.has(event.sender)) event.sender.once("destroyed", () => { unreadByWindow.delete(event.sender); showUnread(); });
    unreadByWindow.set(event.sender, { count, openUnread: input?.openUnread === true });
    showUnread();
  });

  ipcMain.handle("telar:notifications:test", (_event, input) => testNotification(input?.sounds));

  ipcMain.handle("telar:metrics:read", () => processMetricsReader().summary());

  ipcMain.handle("telar:metrics:runaway", () => lastRunawayNotice());

  ipcMain.handle("telar:engine:restart", () => lastEngineRestart());

  ipcMain.handle("telar:window:visibility", (event) => windowVisible(BrowserWindow.fromWebContents(event.sender)));

  ipcMain.handle("telar:links:set-routing", (event, input) => {
    const asking = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents === event.sender);
    if (!asking || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Only a Telar window may route its own links.");
    }
    linkRouting.set(event.sender, input?.on === true);
    return { ok: true };
  });

  ipcMain.handle("telar:app:open-window", (event, input) => {
    const asking = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents === event.sender);
    if (!asking || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Only a Telar window may open another one.");
    }
    const target = windowTargetUrl(asking.webContents.getURL() || lastWindowUrl(), input?.path);
    if (!target) return { ok: false, error: "A new window only opens on a page inside Telar." };
    createWindow(target);
    return { ok: true };
  });
}

module.exports = { registerAppIpc };
