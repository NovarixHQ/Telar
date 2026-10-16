const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DesktopBrowserManager } = require("./browser-manager");
const { cockpitWindowOptions } = require("../main/cockpit-window");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "telar-page-edge-")));
dialog.showErrorBox = () => undefined;

const TAB_PAGE = `<!doctype html><body style="margin:0;height:100vh;background:#7255ba"></body>`;
const COCKPIT_PAGE = `<!doctype html><body><script>
  window.edges_ = [];
  window.telarDesktop.browser.onNearBottom((report) => edges_.push(report.near));
</script></body>`;

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (line) => console.log(`PAGE_EDGE ${line}`);
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }
async function until(read, accept, label, tries = 100) {
  let value;
  for (let i = 0; i < tries; i += 1) {
    value = await read();
    if (accept(value)) return value;
    await delay(20);
  }
  throw new Error(`${label}: last value ${JSON.stringify(value)}`);
}

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.url.startsWith("/tab") ? TAB_PAGE : COCKPIT_PAGE);
  });
  const base = `http://127.0.0.1:${await listen(server)}`;
  const win = new BrowserWindow({ ...cockpitWindowOptions("page edge"), show: false, width: 1000, height: 700 });
  const manager = new DesktopBrowserManager(win);
  try {
    await win.loadURL(`${base}/`);
    win.showInactive();
    manager.declareProfile("s", "none");
    manager.setBounds("s", { x: 0, y: 0, width: 1000, height: 600 });
    await manager.setVisible("s", true);
    await manager.action("s", { action: "new", url: `${base}/tab` });
    const page = manager.activeTab("s").view.webContents;
    await until(() => page.executeJavaScript("document.readyState"), (state) => state === "complete", "tab load");
    const edges = () => win.webContents.executeJavaScript("JSON.stringify(edges_)").then(JSON.parse);
    const move = (y) => page.sendInputEvent({ type: "mouseMove", x: 500, y });
    const bottom = manager.activeTab("s").view.getBounds().height;

    move(300);
    move(bottom - 20);
    await until(edges, (seen) => seen.at(-1) === true, "the pointer at the page's bottom edge is reported");
    move(bottom - 10);
    move(300);
    await until(edges, (seen) => seen.at(-1) === false, "the pointer leaving the edge is reported");
    note(`reports while moving mid → bottom → bottom → mid: ${JSON.stringify(await edges())}`);
    assert(JSON.stringify(await edges()) === "[true,false]", "a report was sent for a move that changed nothing");

    const above = win.contentView.children.filter((child) => child !== manager.activeTab("s").view && child.getVisible?.());
    note(`views over the page while the notch is hidden: ${above.length}`);
    assert(above.length === 0, "something is drawn over the page's bottom edge while the notch is hidden");
    console.log("PAGE_EDGE_OK");
  } finally {
    try { manager.destroy(); } catch {}
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    await removeUserData(app.getPath("userData"));
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("PAGE_EDGE_FAIL", error);
    app.exit(1);
  },
);
