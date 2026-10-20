const os = require("node:os");
const { app, ipcMain } = require("electron");

const isLink = (value) => /^(https?|telar):\/\//i.test(String(value).trim());

function registerRemoteHostIpc({ remoteHost, sshHosts }) {
  const fromCockpit = (event) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Only the cockpit may change where Telar runs.");
  };
  const relaunch = (changed) => {
    if (!changed) return;
    app.relaunch();
    app.quit();
  };

  ipcMain.handle("telar:host:get", () => remoteHost.publicMode());

  ipcMain.handle("telar:host:connect", async (event, input) => {
    fromCockpit(event);
    const link = isLink(input?.link) ? input.link : (await sshHosts.add(input?.link)).pairingUrl;
    const mode = await remoteHost.connect(link, os.hostname());
    relaunch(true);
    return mode;
  });

  ipcMain.handle("telar:host:ssh-pair", (event, input) => {
    fromCockpit(event);
    return sshHosts.add(input?.target);
  });

  ipcMain.handle("telar:host:ssh-release", (event, input) => {
    fromCockpit(event);
    return typeof input?.baseUrl === "string" && sshHosts.release(input.baseUrl);
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
