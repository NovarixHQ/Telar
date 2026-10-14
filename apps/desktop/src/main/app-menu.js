const { app, BrowserWindow, Menu } = require("electron");
const { claimedCommandIds, keymapOverrides, menuCommands, mergeKeymap, resolveCommandForEvent } = require("./command-keys");
const { ChordScopes } = require("./chord-scope");
const { browserManagers } = require("./browser-hosts");
const { jsonPrefs } = require("./prefs");
const { DEV_BUILD } = require("./flags");
const devUpdate = require("../dev/dev-update");
const { devMenuItem } = require("../dev/pair-simulators");

const scopes = new ChordScopes();
const capturing = new Set();
const tracked = new WeakSet();
let menuWindow = null;
let builtFor = null;

const { read: readKeybindingOverrides, write: writeKeybindingOverrides } = jsonPrefs(
  "keybindings.json",
  {},
  (raw) => keymapOverrides(mergeKeymap(raw)),
  "keybindings",
);

function readKeymap() {
  return mergeKeymap(readKeybindingOverrides());
}

// The application menu is app-wide, so it carries the focused window's claims: its renderer's and its browser's.
function menuState() {
  const win = menuWindow && !menuWindow.isDestroyed() ? menuWindow : BrowserWindow.getFocusedWindow();
  if (!win) return { capturing: false, chords: [] };
  const manager = [...browserManagers].find((candidate) => candidate.windowOfSender(win.webContents));
  return { capturing: capturing.has(win), chords: scopes.of([win, manager]) };
}

function syncApplicationMenu() {
  if (JSON.stringify(menuState()) !== builtFor) buildApplicationMenu();
}

function forgetWindowChords(win) {
  scopes.forget(win);
  capturing.delete(win);
  syncApplicationMenu();
}

function trackWindow(win) {
  if (tracked.has(win)) return;
  tracked.add(win);
  win.webContents.on("did-start-loading", () => forgetWindowChords(win));
  win.on("closed", () => forgetWindowChords(win));
}

function setChordCapture(win, on) {
  trackWindow(win);
  if (on) capturing.add(win);
  else capturing.delete(win);
  syncApplicationMenu();
  return capturing.has(win);
}

function setRendererChordScope(win, requested) {
  trackWindow(win);
  scopes.setOwner(win, requested);
  syncApplicationMenu();
  return scopes.get(win);
}

function setBrowserChordScope(manager, owned) {
  if (scopes.setOwner(manager, owned)) syncApplicationMenu();
}

function forgetBrowserChordScope(manager) {
  if (scopes.forget(manager)) syncApplicationMenu();
}

function followFocusedWindow() {
  app.on("browser-window-focus", (_event, win) => {
    menuWindow = win;
    syncApplicationMenu();
  });
}

function sendCommandKey(browserWindow, id) {
  const win = browserWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  win?.webContents.send("telar:command-keys:invoke", id);
}

const PAGE_COMMANDS = new Set(["toggle-dictation"]);

function forwardPageCommand(win, input) {
  const id = resolveCommandForEvent(readKeymap(), { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift });
  if (!PAGE_COMMANDS.has(id)) return false;
  sendCommandKey(win, id);
  return true;
}

function buildApplicationMenu(keymap = readKeymap()) {
  const state = menuState();
  builtFor = JSON.stringify(state);
  const claimed = new Set(claimedCommandIds(keymap, state.chords));
  const toMenuItem = (command) => ({
    label: command.label,

    ...(command.accelerator && !state.capturing && !claimed.has(command.id) ? { accelerator: command.accelerator } : {}),
    enabled: !state.capturing,
    click: (_menuItem, browserWindow) => sendCommandKey(browserWindow, command.id),
  });
  const fileCommands = menuCommands(keymap, "file");
  const panelCommands = menuCommands(keymap, "panel");
  const panelTabBindings = panelCommands.filter((command) => command.panelTab);
  const viewCommands = menuCommands(keymap, "view");
  const windowCommands = menuCommands(keymap, "window");

  const jumpBindings = fileCommands.filter((command) => command.jump);
  const otherBindings = fileCommands.filter((command) => !command.jump);
  const isMac = process.platform === "darwin";
  const template = [

    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        ...otherBindings.map(toMenuItem),
        { type: "separator" },

        { label: "Jump to", submenu: jumpBindings.map(toMenuItem) },

        ...(DEV_BUILD
          ? [
              { type: "separator" },
              { label: "Update from Local Checkout…", click: () => devUpdate.openWindow() },
              ...[devMenuItem()].filter(Boolean),
            ]
          : []),
      ],
    },
    { role: "editMenu" },

    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        ...viewCommands.map(toMenuItem),
        { role: "toggleDevTools", label: "Cockpit Developer Tools", accelerator: "CommandOrControl+Alt+Shift+I" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },

    {
      label: "Panel",
      submenu: [
        ...panelCommands.filter((command) => !command.panelTab).map(toMenuItem),
        { type: "separator" },
        { label: "Select tab", submenu: panelTabBindings.map(toMenuItem) },
      ],
    },
    {
      role: "window",
      submenu: [
        ...windowCommands.map(toMenuItem),
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = {
  buildApplicationMenu,
  followFocusedWindow,
  forgetBrowserChordScope,
  forwardPageCommand,
  readKeybindingOverrides,
  setBrowserChordScope,
  setChordCapture,
  setRendererChordScope,
  writeKeybindingOverrides,
};
