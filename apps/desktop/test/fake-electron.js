const { mock } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

class Emitter {
  constructor() {
    this.listeners = new Map();
  }
  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(listener);
    return this;
  }
  once(event, listener) {
    return this.on(event, listener);
  }
  emit(event, ...args) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

class FakeWebContents extends Emitter {
  constructor(url = "") {
    super();
    this.mainFrame = { name: "main" };
    this.url = url;
    this.sent = [];
    this.windowOpenHandler = null;
  }
  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
  reload() {
    this.reloads = (this.reloads ?? 0) + 1;
  }
  send(channel, payload) {
    this.sent.push({ channel, payload });
  }
  focus() {
    this.focused = (this.focused ?? 0) + 1;
  }
  getURL() {
    return this.url;
  }
  isDestroyed() {
    return false;
  }
}

class FakeBrowserWindow extends Emitter {
  static all = [];
  static focused = null;
  static getAllWindows() {
    return FakeBrowserWindow.all.filter((win) => !win.destroyed);
  }
  static getFocusedWindow() {
    return FakeBrowserWindow.focused;
  }
  static fromWebContents(contents) {
    return FakeBrowserWindow.all.find((win) => win.webContents === contents) ?? null;
  }
  constructor(options = {}) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.title = options.title;
    this.loaded = [];
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 800, height: options.height ?? 600 };
    this.fullscreen = false;
    FakeBrowserWindow.all.push(this);
  }
  getNormalBounds() {
    return { ...this.bounds };
  }
  isFullScreen() {
    return this.fullscreen;
  }
  isMaximized() {
    return this.maximized === true;
  }
  maximize() {
    this.maximized = true;
  }
  setFullScreen(on) {
    this.fullscreen = on;
  }
  getContentSize() {
    return [this.bounds.width, this.bounds.height];
  }
  setBounds(bounds) {
    this.bounds = { ...this.bounds, ...bounds };
  }
  setMinimumSize(width, height) {
    this.minimumSize = [width, height];
  }
  setWindowButtonVisibility(visible) {
    this.windowButtons = visible;
  }
  setAspectRatio(ratio) {
    this.aspectRatio = ratio;
  }
  setAlwaysOnTop(on, level) {
    this.onTop = on ? level : false;
  }
  setVisibleOnAllWorkspaces(on, options) {
    this.allWorkspaces = on ? options : false;
    this.allWorkspacesOptions = options;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible === true;
  }
  hide() {
    this.visible = false;
  }
  setPosition(x, y) {
    this.bounds = { ...this.bounds, x, y };
  }
  getPosition() {
    return [this.bounds.x, this.bounds.y];
  }
  getBounds() {
    return { ...this.bounds };
  }
  setIgnoreMouseEvents(ignore, options) {
    this.ignoresMouse = ignore ? options ?? {} : false;
  }
  setContentSize(width, height) {
    this.bounds = { ...this.bounds, width, height };
  }
  getMediaSourceId() {
    return `window:${FakeBrowserWindow.all.indexOf(this) + 1}:0`;
  }
  isMinimized() {
    return false;
  }
  isFocused() {
    return FakeBrowserWindow.focused === this;
  }
  setTitle(title) {
    this.title = title;
  }
  loadURL(url) {
    this.loaded.push(url);
    this.webContents.url = url;
  }
  setVibrancy(material) {
    this.vibrancy = material;
  }
  setBackgroundColor(color) {
    this.backgroundColor = color;
  }
  show() {
    this.visible = true;
  }
  focus() {
    FakeBrowserWindow.focused = this;
    this.emit("focus");
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }
}

const ipcMain = {
  handlers: new Map(),
  listeners: new Map(),
  handle(channel, handler) {
    this.handlers.set(channel, handler);
  },
  on(channel, listener) {
    this.listeners.set(channel, listener);
  },
  invoke(channel, event, ...args) {
    return this.handlers.get(channel)(event, ...args);
  },
  send(channel, event, ...args) {
    return this.listeners.get(channel)(event, ...args);
  },
};

class FakeNotification extends Emitter {
  static shown = [];
  constructor(options) {
    super();
    this.options = options;
  }
  show() {
    FakeNotification.shown.push(this);
  }
}

const globalShortcut = {
  registered: new Map(),
  refused: new Set(),
  register(chord, callback) {
    if (globalShortcut.refused.has(chord)) return false;
    globalShortcut.registered.set(chord, callback);
    return true;
  },
  isRegistered: (chord) => globalShortcut.registered.has(chord),
  unregister: (chord) => globalShortcut.registered.delete(chord),
  press: (chord) => globalShortcut.registered.get(chord)?.(),
};

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-fake-electron-"));

const electron = {
  app: Object.assign(new Emitter(), {
    isPackaged: false,
    isQuitting: false,
    quits: 0,
    switches: [],
    commandLine: { appendSwitch: (...args) => electron.app.switches.push(args) },
    paths: {},
    name: "Telar",
    getPath: () => userData,
    setPath: (name, value) => { electron.app.paths[name] = value; },
    setName: (name) => { electron.app.name = name; },
    getName: () => "Telar",
    getVersion: () => "0.0.0-test",
    quit: () => { electron.app.quits += 1; },
    focused: 0,
    focus: () => { electron.app.focused += 1; },
    hidden: 0,
    hide: () => { electron.app.hidden += 1; },
    badgeCount: 0,
    setBadgeCount: (count) => { electron.app.badgeCount = count; return true; },
  }),
  BrowserWindow: FakeBrowserWindow,
  contextBridge: { exposed: {}, exposeInMainWorld: (name, api) => { electron.contextBridge.exposed[name] = api; } },
  dialog: {
    shown: [],
    showErrorBox: (title, detail) => electron.dialog.shown.push({ kind: "error", title, detail }),
    showMessageBoxSync: (options) => { electron.dialog.shown.push({ kind: "message", ...options }); return 0; },
  },
  globalShortcut,
  ipcMain,
  Notification: FakeNotification,
  ipcRenderer: Object.assign(new Emitter(), {
    invoked: [],
    invoke: (channel, payload) => { electron.ipcRenderer.invoked.push([channel, payload]); return Promise.resolve(); },
    removeListener: (channel, listener) => {
      const listeners = electron.ipcRenderer.listeners.get(channel) ?? [];
      electron.ipcRenderer.listeners.set(channel, listeners.filter((candidate) => candidate !== listener));
    },
  }),
  Menu: { buildFromTemplate: (template) => template, setApplicationMenu: (menu) => { electron.Menu.current = menu; } },
  nativeTheme: Object.assign(new Emitter(), { shouldUseDarkColors: false, themeSource: "system" }),
  powerMonitor: Object.assign(new Emitter(), { getSystemIdleState: () => "active" }),
  session: { defaultSession: { cookies: { set: async () => {} }, webRequest: { onBeforeSendHeaders() {} } }, fromPartition: () => ({}) },
  screen: {
    displays: [{ id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } }],
    getAllDisplays: () => electron.screen.displays,
    getPrimaryDisplay: () => electron.screen.displays[0],
    getDisplayMatching: (rect) => electron.screen.displays.find((display) => rect.x >= display.workArea.x && rect.x < display.workArea.x + display.workArea.width) ?? electron.screen.displays[0],
    cursor: { x: 0, y: 0 },
    getCursorScreenPoint: () => ({ ...electron.screen.cursor }),
    getDisplayNearestPoint: (point) => electron.screen.getDisplayMatching(point),
    listeners: new Map(),
    on: (name, listener) => electron.screen.listeners.set(name, [...(electron.screen.listeners.get(name) ?? []), listener]),
    emit: (name, ...args) => (electron.screen.listeners.get(name) ?? []).forEach((listener) => listener({}, ...args)),
  },
  shell: { opened: [], openExternal: (url) => { electron.shell.opened.push(url); return Promise.resolve(); }, showItemInFolder: (target) => electron.shell.opened.push(target), openPath: (target) => { electron.shell.opened.push(target); return Promise.resolve(""); } },
  webContents: { getAllWebContents: () => [] },
  systemPreferences: {
    trusted: false,
    prompted: 0,
    screen: "denied",
    isTrustedAccessibilityClient: (prompt) => { if (prompt) electron.systemPreferences.prompted += 1; return electron.systemPreferences.trusted; },
    getMediaAccessStatus: () => electron.systemPreferences.screen,
  },
  desktopCapturer: { sources: [], getSources: async () => electron.desktopCapturer.sources },
};

mock.module("electron", () => electron);

/** Clears what a test recorded; the module mock itself stays for the whole run. */
function resetElectron() {
  electron.app.hidden = 0;
  FakeBrowserWindow.all = [];
  FakeBrowserWindow.focused = null;
  ipcMain.handlers.clear();
  ipcMain.listeners.clear();
  electron.shell.opened = [];
  electron.dialog.shown = [];
  electron.app.quits = 0;
  electron.app.isQuitting = false;
  electron.app.switches = [];
  electron.app.paths = {};
  electron.app.name = "Telar";
  electron.app.isPackaged = false;
  electron.app.badgeCount = 0;
  electron.app.focused = 0;
  globalShortcut.registered.clear();
  globalShortcut.refused.clear();
  FakeNotification.shown = [];
  Object.assign(electron.systemPreferences, { trusted: false, prompted: 0, screen: "denied" });
  electron.desktopCapturer.sources = [];
  electron.nativeTheme.shouldUseDarkColors = false;
  electron.screen.displays = [{ id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } }];
  electron.screen.cursor = { x: 0, y: 0 };
  electron.screen.listeners = new Map();
  for (const emitter of [electron.app, electron.nativeTheme, electron.powerMonitor]) emitter.listeners.clear();
}

/** An IPC event from `win`'s top frame, or from somewhere else when `sender`/`frame` say so. */
function eventFrom(win, { sender = win.webContents, frame = win.webContents.mainFrame } = {}) {
  return { sender, senderFrame: frame };
}

module.exports = { electron, eventFrom, FakeBrowserWindow, FakeNotification, FakeWebContents, resetElectron, userData };
