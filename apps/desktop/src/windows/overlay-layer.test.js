const { afterAll, describe, expect, mock, test } = require("bun:test");
const { EventEmitter } = require("node:events");
const { electron, FakeBrowserWindow } = require("../../test/fake-electron");

const keys = { holder: "cockpit" };

function contents(name, extra = {}) {
  return Object.assign(new EventEmitter(), {
    sent: [],
    isFocused: () => keys.holder === name,
    focus: () => { keys.holder = name; },
    isDestroyed: () => false,
    send(channel) { this.sent.push(channel); },
    enableDeviceEmulation: () => undefined,
    close: () => undefined,
    getZoomFactor: () => 1,
  }, extra);
}

const cockpit = contents("cockpit");
const win = Object.assign(new EventEmitter(), {
  webContents: cockpit,
  contentView: { addChildView: () => undefined, removeChildView: () => undefined },
  getContentSize: () => [1200, 800],
  isDestroyed: () => false,
  isFocused: () => true,
});

mock.module("electron", () => electron);
const ownView = !electron.WebContentsView;
electron.WebContentsView ??= class {
  constructor({ webContents }) { this.webContents = webContents; }
  setBackgroundColor() {}
  setVisible() {}
  setBounds() {}
};
const setRect = (rect) => electron.ipcMain.send("telar:overlay:set-rect", { sender: cockpit }, rect);

const { adoptOverlay, registerOverlayIpc } = require("./overlay-layer");

afterAll(() => {
  FakeBrowserWindow.all = FakeBrowserWindow.all.filter((candidate) => candidate !== win);
  if (ownView) delete electron.WebContentsView;
});

describe("an open overlay closes when the keys leave it", () => {
  test("the cockpit taking the keys without a click still closes it", async () => {
    FakeBrowserWindow.all.push(win);
    registerOverlayIpc();
    const overlay = contents("overlay");
    adoptOverlay(win, { webContents: overlay });
    setRect({ x: 10, y: 10, width: 100, height: 100 });
    expect(overlay.isFocused()).toBe(true);

    cockpit.focus();
    overlay.emit("blur");
    await new Promise((resolve) => setImmediate(resolve));
    expect(cockpit.sent).toContain("telar:overlay:outside");
  });

  test("the window losing focus to another app leaves it open", async () => {
    const overlay = contents("overlay");
    adoptOverlay(win, { webContents: overlay });
    setRect({ x: 10, y: 10, width: 100, height: 100 });
    cockpit.sent.length = 0;
    win.isFocused = () => false;
    keys.holder = "elsewhere";
    overlay.emit("blur");
    await new Promise((resolve) => setImmediate(resolve));
    expect(cockpit.sent).not.toContain("telar:overlay:outside");
    win.isFocused = () => true;
  });
});
