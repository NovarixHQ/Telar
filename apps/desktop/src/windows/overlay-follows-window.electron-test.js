const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { cockpitWindowOptions } = require("../main/cockpit-window");
const { applyExternalLinkPolicy } = require("../main/window-links");
const { createExternalLinkPolicy } = require("../browser/browser-manager");
const { registerOverlayIpc } = require("./overlay-layer");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "telar-overlay-follows-")));
dialog.showErrorBox = () => undefined;

const COCKPIT = `<!doctype html><body style="margin:0"><script>
  const child = window.open("", "telar-overlay");
  child.document.body.style.margin = "0";
  const shade = child.document.createElement("div");
  shade.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35)";
  child.document.body.append(shade);
  let sent = "";
  const tick = () => {
    const r = shade.getBoundingClientRect();
    const rect = { x: 0, y: 0, width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight) };
    const key = rect.width + "x" + rect.height + "@" + innerWidth + "x" + innerHeight;
    if (key !== sent) { sent = key; window.telarDesktop.overlay.setRect(rect); }
    requestAnimationFrame(tick);
  };
  tick();
</script></body>`;

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (line) => console.log(`OVERLAY_FOLLOWS ${line}`);
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }

async function covers(win, view, label) {
  let last;
  for (let i = 0; i < 100; i += 1) {
    const [width, height] = win.getContentSize();
    const bounds = view.getBounds();
    const zoom = win.webContents.getZoomFactor();
    const inner = await view.webContents.executeJavaScript("[innerWidth, innerHeight]");
    last = { content: [width, height], bounds: [bounds.x, bounds.y, bounds.width, bounds.height], overlay: inner, zoom };
    const fits = bounds.x === 0 && bounds.y === 0 && Math.abs(bounds.width - width) <= 1 && Math.abs(bounds.height - height) <= 1;
    const lays = Math.abs(inner[0] * zoom - width) <= 2 && Math.abs(inner[1] * zoom - height) <= 2;
    if (fits && lays && view.getVisible()) {
      note(`${label}: covers ${width}×${height}`);
      return;
    }
    await delay(20);
  }
  throw new Error(`${label}: the overlay does not cover the window: ${JSON.stringify(last)}`);
}

const once = (win, event) => new Promise((resolve) => win.once(event, resolve));

async function adopted(win) {
  for (let i = 0; i < 100; i += 1) {
    const found = win.contentView.children.find((child) => child.webContents && child.webContents !== win.webContents);
    if (found) return found;
    await delay(20);
  }
  throw new Error("the overlay was never adopted");
}

async function main() {
  registerOverlayIpc();
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(COCKPIT);
  });
  const base = `http://127.0.0.1:${await listen(server)}`;
  const win = new BrowserWindow({ ...cockpitWindowOptions("overlay follows"), show: false, width: 900, height: 600 });
  applyExternalLinkPolicy(win.webContents, () => createExternalLinkPolicy({ appUrl: `${base}/` }));
  try {
    await win.loadURL(`${base}/`);
    win.show();
    const view = await adopted(win);
    let cases = 0;
    const check = async (label) => {
      await covers(win, view, label);
      cases += 1;
    };
    await check("opened");
    win.setContentSize(1300, 860);
    await check("grown");
    win.setContentSize(700, 480);
    await check("shrunk");
    win.webContents.setZoomFactor(1.2);
    await check("zoomed in");
    win.setContentSize(1100, 760);
    await check("grown while zoomed");
    win.webContents.setZoomFactor(1);
    await check("zoom reset");
    if (process.platform === "darwin") {
      const entered = once(win, "enter-full-screen");
      win.setFullScreen(true);
      await entered;
      await check("fullscreen");
      const left = once(win, "leave-full-screen");
      win.setFullScreen(false);
      await left;
      await check("left fullscreen");
    }
    assert(cases >= 6, "not every case ran");
    console.log(`OVERLAY_FOLLOWS_OK ${cases}`);
  } finally {
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    await removeUserData(app.getPath("userData"));
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("OVERLAY_FOLLOWS_FAIL", error);
    app.exit(1);
  },
);
