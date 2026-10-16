const { app, BrowserWindow, dialog, globalShortcut } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { cockpitWindowOptions } = require("./cockpit-window");
const { createQuickComposer } = require("./quick-composer");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "telar-compose-summon-")));
dialog.showErrorBox = () => undefined;

const COCKPIT = `<!doctype html><body><textarea id="box"></textarea><script>
  window.summons_ = 0;
  window.hasComposer_ = true;
  window.telarDesktop.compose.onSummon(() => {
    summons_ += 1;
    if (!hasComposer_) return false;
    document.getElementById("box").focus();
    return true;
  });
</script></body>`;

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (line) => console.log(`COMPOSE_SUMMON ${line}`);
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.url.startsWith("/surface/quick") ? "<!doctype html><body></body>" : COCKPIT);
  });
  const base = `http://127.0.0.1:${await listen(server)}/`;
  let chord = null;
  const realRegister = globalShortcut.register.bind(globalShortcut);
  globalShortcut.register = (accelerator, callback) => {
    chord = callback;
    return true;
  };
  const quick = createQuickComposer({ appUrl: base, openRoute: () => undefined, readContext: async () => ({ app: "Telar" }) });
  quick.bind("Alt+Shift+Space");
  const panel = () => BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Quick Composer");
  const win = new BrowserWindow({ ...cockpitWindowOptions("cockpit"), show: false, width: 800, height: 600 });
  try {
    await win.loadURL(base);
    app.focus({ steal: true });
    win.show();
    win.focus();
    await delay(200);
    assert(BrowserWindow.getFocusedWindow() === win, "the cockpit window is not the focused window");

    chord();
    await delay(400);
    const summons = await win.webContents.executeJavaScript("summons_");
    const focused = await win.webContents.executeJavaScript("document.activeElement.id");
    note(`cockpit in front with a composer: asked ${summons}×, focus on #${focused}, panel visible=${Boolean(panel()?.isVisible())}`);
    assert(summons === 1 && focused === "box", "the cockpit was not asked to focus its composer");
    assert(!panel()?.isVisible(), "the Quick Composer opened over a Telar window that had a composer");

    await win.webContents.executeJavaScript("hasComposer_ = false");
    chord();
    await delay(600);
    note(`cockpit in front without a composer: panel visible=${Boolean(panel()?.isVisible())}`);
    assert(panel()?.isVisible(), "the Quick Composer did not open for a Telar window without a composer");
    console.log("COMPOSE_SUMMON_OK");
  } finally {
    globalShortcut.register = realRegister;
    for (const each of BrowserWindow.getAllWindows()) each.destroy();
    await new Promise((resolve) => server.close(resolve));
    await removeUserData(app.getPath("userData"));
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("COMPOSE_SUMMON_FAIL", error);
    app.exit(1);
  },
);
