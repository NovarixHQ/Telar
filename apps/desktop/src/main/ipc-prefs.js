const { BrowserWindow, ipcMain, nativeTheme } = require("electron");
const { keymapOverrides, mergeKeymap } = require("./command-keys");
const { applyTranslucency, readUiPrefs, supportsTranslucency, writeUiPrefs } = require("./appearance");
const {
  buildApplicationMenu,
  readKeybindingOverrides,
  setChordCapture,
  setRendererChordScope,
  writeKeybindingOverrides,
} = require("./app-menu");

function registerPrefsIpc({ onKeymap = () => {}, onCapture = () => {} } = {}) {
  ipcMain.handle("telar:appearance:setTheme", (_event, theme) => {
    if (theme === "light" || theme === "dark" || theme === "system") nativeTheme.themeSource = theme;
  });

  ipcMain.handle("telar:keybindings:get", () => readKeybindingOverrides());

  ipcMain.handle("telar:keybindings:capture", (event, capturing) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    onCapture(Boolean(capturing));
    return win ? setChordCapture(win, Boolean(capturing)) : false;
  });

  ipcMain.handle("telar:keybindings:scope", (event, requested) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? setRendererChordScope(win, requested) : [];
  });

  ipcMain.handle("telar:keybindings:set", (_event, overrides) => {
    const stored = keymapOverrides(mergeKeymap(overrides));
    writeKeybindingOverrides(stored);
    buildApplicationMenu(mergeKeymap(stored));
    onKeymap(mergeKeymap(stored));
    return stored;
  });

  ipcMain.handle("telar:appearance:get", () => ({ ...readUiPrefs(), supported: supportsTranslucency() }));

  ipcMain.handle("telar:appearance:set", (_event, patch) => {
    const current = readUiPrefs();
    const next = {
      translucent: typeof patch?.translucent === "boolean" ? patch.translucent : current.translucent,
      frost: patch?.frost === "clear" || patch?.frost === "blur" ? patch.frost : current.frost,
    };
    writeUiPrefs(next);

    if (supportsTranslucency()) applyTranslucency(next.translucent, next.frost);
    return { ...next, supported: supportsTranslucency() };
  });
}

module.exports = { registerPrefsIpc };
