const os = require("node:os");
const { app, ipcMain } = require("electron");

function registerRemoteHostIpc({ remoteHost }) {
  const fromCockpit = (event) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Only the cockpit may change where Telar runs.");
  };
  const relaunch = (changed) => {
    if (!changed) return;
    app.relaunch();
    app.quit();
  };

  ipcMain.on("telar:host:mode-sync", (event) => {
    event.returnValue = remoteHost.publicMode();
  });
  ipcMain.handle("telar:host:get", () => remoteHost.publicMode());

  ipcMain.handle("telar:host:connect", async (event, input) => {
    fromCockpit(event);
    const mode = await remoteHost.connect(input?.link, os.hostname());
    relaunch(true);
    return mode;
  });

  ipcMain.handle("telar:host:set-local", (event, input) => {
    fromCockpit(event);
    const before = remoteHost.mode().local;
    const mode = remoteHost.useLocal(input?.on === true);
    relaunch(mode.local !== before);
    return mode;
  });

  ipcMain.handle("telar:host:forget", (event) => {
    fromCockpit(event);
    const before = remoteHost.mode().local;
    const mode = remoteHost.forget();
    relaunch(!before);
    return mode;
  });
}

module.exports = { registerRemoteHostIpc };
