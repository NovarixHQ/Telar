const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DesktopBrowserManager } = require("./browser-manager");
const { cockpitWindowOptions } = require("../main/cockpit-window");
const { registerOverlayIpc } = require("../windows/overlay-layer");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

dialog.showErrorBox = () => undefined;
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "telar-blank-tab-")));

const PANEL = { x: 600, y: 80, width: 560, height: 680 };
const FULL = { x: 0, y: 80, width: 1200, height: 680 };
const COLOURS = { a: "#2a9d8f", b: "#e76f51" };

const tabPage = (colour) => `<!doctype html><html><head><meta charset="utf-8"><title>tab</title>
<style>html,body{margin:0;height:100%;background:${colour}}</style></head><body></body></html>`;

const COCKPIT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cockpit</title>
<style>body{margin:0;background:#202020}</style></head><body><script>
  window.showMenu = (rect) => {
    const doc = window.open('', 'telar-overlay').document;
    doc.head.innerHTML = '<style>html,body{margin:0;background:transparent}</style>';
    doc.body.innerHTML = '<div style="position:absolute;left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;background:#fff"></div>';
    window.telarDesktop.overlay.setRect(rect);
  };
  window.hideMenu = () => window.telarDesktop.overlay.setRect(null);
</script></body></html>`;

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (line) => console.log(`BLANK_TAB ${line}`);
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }
async function until(read, accept, label, tries = 100) {
  let value;
  for (let i = 0; i < tries; i += 1) {
    value = await read().catch((error) => ({ error: String(error?.message || error) }));
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error(`${label}: last value ${JSON.stringify(value)}`);
}

function hex(image) {
  if (!image || image.isEmpty()) return "empty";
  const size = image.getSize();
  const bitmap = image.toBitmap();
  const o = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
  return `#${[bitmap[o + 2], bitmap[o + 1], bitmap[o]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function near(a, b) {
  if (typeof a !== "string" || a === "empty") return false;
  const channels = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= 6);
}

async function main() {
  registerOverlayIpc();
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const colour = request.url.startsWith("/a") ? COLOURS.a : request.url.startsWith("/b") ? COLOURS.b : null;
    response.end(colour ? tabPage(colour) : COCKPIT_PAGE);
  });
  const base = `http://127.0.0.1:${await listen(server)}`;
  const win = new BrowserWindow({ ...cockpitWindowOptions("blank tab"), show: false, width: 1200, height: 800 });
  const manager = new DesktopBrowserManager(win);
  try {
    await win.loadURL(`${base}/`);
    win.show();
    const cockpit = win.webContents;

    manager.declareProfile("s", "none");
    manager.setBounds("s", PANEL);
    await manager.setVisible("s", true);
    await manager.action("s", { action: "new", url: `${base}/a` });
    await manager.action("s", { action: "new", url: `${base}/b` });
    let expected = { colour: COLOURS.b, rect: PANEL };

    const check = async (step) => {
      const tab = manager.activeTab("s");
      const view = tab.view;
      assert(view && !view.webContents.isDestroyed(), `${step}: the active tab has no live view`);
      const children = win.contentView.children;
      const index = children.indexOf(view);
      assert(index >= 0, `${step}: the tab view is not mounted`);
      for (const above of children.slice(index + 1)) {
        assert(!above.getVisible() || above.webContents === cockpit || above.webContents.getOSProcessId() === cockpit.getOSProcessId(), `${step}: a foreign view sits above the tab`);
      }
      await until(async () => ({ visible: view.getVisible(), bounds: view.getBounds(), crashed: view.webContents.isCrashed() }),
        (s) => s.visible && !s.crashed && JSON.stringify(s.bounds) === JSON.stringify(expected.rect), `${step}: the tab view is not visible at its rect`);
      await until(async () => hex(await view.webContents.capturePage()), (c) => near(c, expected.colour), `${step}: the tab does not paint ${expected.colour}`);
      note(`${step}: ok`);
    };

    await check("first paint");
    for (let round = 0; round < 3; round += 1) {
      await cockpit.executeJavaScript(`showMenu(${JSON.stringify({ x: PANEL.x + 40, y: PANEL.y + 40, width: 200, height: 120 })})`);
      await manager.setVisible("s", false);
      await cockpit.executeJavaScript("hideMenu()");
      await manager.setVisible("s", true);
      await check(`menu over the tab, round ${round}`);

      manager.setBounds("s", FULL);
      expected = { ...expected, rect: FULL };
      await manager.setVisible("s", false);
      await manager.setVisible("s", true);
      await check(`fullscreen, round ${round}`);

      await manager.action("s", { action: "select", index: 0 });
      expected = { ...expected, colour: COLOURS.a };
      await check(`switch to a, round ${round}`);
      await manager.action("s", { action: "select", index: 1 });
      expected = { ...expected, colour: COLOURS.b };
      await check(`switch to b, round ${round}`);

      manager.setBounds("s", PANEL);
      expected = { ...expected, rect: PANEL };
      await manager.setVisible("s", false);
      win.hide();
      await delay(100);
      win.show();
      await manager.setVisible("s", true);
      await check(`window hidden and shown, round ${round}`);
    }

    const contents = manager.activeTab("s").view.webContents;
    contents.forcefullyCrashRenderer();
    await check("a crashed page reloads");

    contents.forcefullyCrashRenderer();
    const shown = await until(async () => manager.state("s").tabs.find((tab) => tab.active),
      (tab) => tab?.loadError?.code === "ERR_RENDERER_GONE", "a second crash within a minute shows an error");
    assert(!manager.activeTab("s").view.getVisible(), "the crashed view stays up over the error page");
    note(`a crash loop stops at an error page (${shown.loadError.code})`);
    await manager.action("s", { action: "reload" });
    await check("retry after a crash loop");
    console.log("BLANK_TAB_OK");
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
    console.error("BLANK_TAB_FAIL", error);
    app.exit(1);
  },
);
