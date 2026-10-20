const { jsonPrefs } = require("./prefs");

const state = jsonPrefs(
  "origin-migration.json",
  null,
  (data) => ({ done: data.done === true, ...(Number.isInteger(data.fromPort) ? { fromPort: data.fromPort } : {}) }),
  "the origin migration",
);

const READ = "JSON.stringify(Object.entries(localStorage))";
const writeScript = (entries) =>
  `(${JSON.stringify(entries)}).forEach(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }); localStorage.length`;

async function migrateLegacyOrigin({ legacyPort, listeningPort, appUrl, createWindow, log }) {
  const saved = state.read();
  if (saved?.done) return "done";
  const fromPort = saved?.fromPort ?? legacyPort;
  if (!fromPort) {
    state.write({ done: true });
    return "fresh";
  }
  if (fromPort !== listeningPort) {
    log(`origin migration skipped: the old origin used :${fromPort} and the engine listens on :${listeningPort}`);
    state.write({ done: true, fromPort });
    return "unreachable";
  }
  const win = createWindow();
  try {
    await win.loadURL(`http://127.0.0.1:${fromPort}/v2/ping`);
    const entries = JSON.parse(await win.webContents.executeJavaScript(READ));
    await win.loadURL(`${appUrl}migrate`);
    await win.webContents.executeJavaScript(writeScript(entries));
    await win.webContents.session.flushStorageData();
    state.write({ done: true, fromPort });
    log(`origin migration moved ${entries.length} localStorage keys from :${fromPort}`);
    return "migrated";
  } catch (error) {
    log(`origin migration failed, will retry next launch: ${error?.message || error}`);
    return "failed";
  } finally {
    win.destroy();
  }
}

module.exports = { migrateLegacyOrigin };
