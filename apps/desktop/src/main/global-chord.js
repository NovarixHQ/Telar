"use strict";

const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
const { chordRoute, createChordClaim } = require("./chord-claim");

function createGlobalChord({ press, claimChord, log = () => {} }) {
  const judge = claimChord ?? createChordClaim({ route: chordRoute({ ozone: app.commandLine.getSwitchValue("ozone-platform") }) });
  let chord = "";
  let suspended = false;
  let claim = null;

  const announce = (next) => {
    claim = next;
    for (const each of BrowserWindow.getAllWindows()) if (!each.isDestroyed()) each.webContents.send("telar:keybindings:claim", claim);
  };

  const register = async () => {
    if (suspended) return;
    if (!chord) return announce(null);
    const asked = chord;
    const held = globalShortcut.register(chord, press);
    if (!held) log(`quick composer could not claim ${chord}`);
    const outcome = await judge(asked, held);
    if (asked === chord && !suspended) announce(outcome);
  };

  const unregister = () => {
    if (chord && globalShortcut.isRegistered(chord)) globalShortcut.unregister(chord);
  };

  ipcMain.handle("telar:keybindings:claim", () => claim);
  app.on("will-quit", unregister);

  return {
    bind(next) {
      unregister();
      chord = next;
      return register();
    },
    suspend(on) {
      suspended = on;
      if (on) unregister();
      else void register();
    },
  };
}

module.exports = { createGlobalChord };
