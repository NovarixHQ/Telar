const { app, BrowserWindow } = require("electron");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DesktopBrowserManager, createExternalLinkPolicy } = require("./browser-manager");
const { cockpitWindowOptions } = require("../main/cockpit-window");
const { applyExternalLinkPolicy } = require("../main/window-links");
const { registerOverlayIpc } = require("../windows/overlay-layer");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "telar-overlay-menus-")));

const WEB = path.join(__dirname, "../../../web");
const FONT = path.join(path.dirname(createRequire(path.join(WEB, "package.json")).resolve("katex/package.json")), "dist/fonts/KaTeX_Main-Regular.woff2");
const STYLE = `@font-face{font-family:"Face";src:url(/face.woff2) format("woff2");font-display:swap}
body{margin:0;background:#202020;font:13px "Face",monospace}
[data-slot="dropdown-menu-content"]{background:#fff;width:max-content;max-height:var(--available-height);overflow:auto}
[data-slot="dropdown-menu-item"]{height:24px}
.picker{background:#fff;width:min(20rem,calc(100vw - 2rem));max-height:min(30rem,70vh);overflow-y:auto}
.picker-row{height:24px}`;

const TAB_PAGE = `<!doctype html><body style="margin:0;background:#7255ba"></body>`;

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (line) => console.log(`OVERLAY_MENUS ${line}`);
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

function bundlePage(out) {
  const built = spawnSync("bun", ["build", "src/test/overlay-menus.page.tsx", "--outfile", out, "--target", "browser", "--format", "iife", "--define", 'process.env.NODE_ENV="production"'], { cwd: WEB, encoding: "utf8" });
  assert(built.status === 0, `bundling the cockpit's menus failed: ${built.stderr || built.stdout}`);
}

async function sampleShownMenuOnWindow(win, view, selector, ms) {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const rect = await view.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && r.width > 0 ? [r.x, r.y, r.width, r.height] : null; })()`);
    if (rect && view.getVisible()) {
      const at = view.getBounds();
      const key = [Math.round(at.x + rect[0]), Math.round(at.y + rect[1]), Math.round(rect[2]), Math.round(rect[3])].join(",");
      if (seen.at(-1) !== key) seen.push(key);
    }
    await delay(2);
  }
  return seen;
}

async function main() {
  registerOverlayIpc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-overlay-menus-page-"));
  const script = path.join(dir, "page.js");
  bundlePage(script);
  const server = http.createServer((request, response) => {
    if (request.url === "/page.js") return response.end(fs.readFileSync(script));
    if (request.url === "/face.woff2") {
      response.writeHead(200, { "Content-Type": "font/woff2" });
      setTimeout(() => response.end(fs.readFileSync(FONT)), 150);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.url.startsWith("/tab") ? TAB_PAGE : `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="root"></div><script src="/page.js"></script></body></html>`);
  });
  const base = `http://127.0.0.1:${await listen(server)}`;

  const winHolder = {};
  const win = winHolder.win = new BrowserWindow({ ...cockpitWindowOptions("overlay menus"), show: false, width: 1200, height: 800 });
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") note(`page error: ${event.message}`);
  });
  applyExternalLinkPolicy(win.webContents, () => createExternalLinkPolicy({ appUrl: `${base}/` }));
  const manager = new DesktopBrowserManager(win);
  try {
    await win.loadURL(`${base}/`);
    win.showInactive();
    const cockpit = win.webContents;
    manager.declareProfile("s", "none");
    const [width, height] = win.getContentSize();
    manager.setBounds("s", { x: 0, y: 0, width, height });
    await manager.setVisible("s", true);
    await manager.action("s", { action: "new", url: `${base}/tab` });

    const tabContents = manager.activeTab("s").view.webContents;
    const view = await until(async () => win.contentView.children.find((child) => child.webContents && child.webContents !== tabContents), Boolean, "overlay view adopted");

    for (const [trigger, selector] of [["pick", ".picker"], ["low", ".menu-low"], ["high", ".menu-high"]]) {
      const box = await cockpit.executeJavaScript(`(() => { const r = document.getElementById(${JSON.stringify(trigger)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      cockpit.sendInputEvent({ type: "mouseDown", x: Math.round(box[0]), y: Math.round(box[1]), button: "left", clickCount: 1 });
      cockpit.sendInputEvent({ type: "mouseUp", x: Math.round(box[0]), y: Math.round(box[1]), button: "left", clickCount: 1 });
      const seen = await sampleShownMenuOnWindow(win, view, selector, 700);
      note(`${trigger}: on-screen menu rect over time ${JSON.stringify(seen)}`);
      assert(seen.length > 0, `${trigger}: the menu never showed above the browser`);
      assert(seen.length === 1, `${trigger}: the menu moved or resized after it first showed: ${seen.join(" → ")}`);

      const [x, y, w, h] = seen[0].split(",").map(Number);
      if (trigger === "pick") {
        const sized = await view.webContents.executeJavaScript(`[innerWidth, innerHeight]`);
        note(`pick: the overlay lays out at ${sized.join("×")}, the cockpit at ${win.getContentSize().join("×")}`);
        const [cw, ch] = await cockpit.executeJavaScript("[innerWidth, innerHeight]");
        const want = [Math.min(320, cw - 32), Math.round(Math.min(480, ch * 0.7))];
        assert(Math.abs(w - want[0]) <= 1 && Math.abs(h - want[1]) <= 1, `pick: a picker sized by the viewport (min(20rem, 100vw - 2rem) × min(30rem, 70vh)) is ${w}×${h} over the browser, not ${want.join("×")} as in the cockpit`);
      } else {
        await view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).style.minHeight = "${h + 60}px"`);
      const grown = await until(() => sampleShownMenuOnWindow(win, view, selector, 80), (rects) => rects.at(-1)?.endsWith(`,${h + 60}`), `${trigger}: the menu grew in place`).catch((error) => error.message);
      const room = await view.webContents.executeJavaScript(`(() => { let node = document.querySelector(${JSON.stringify(selector)}); while (node && !node.style.getPropertyValue("--available-height")) node = node.parentElement; return node ? parseFloat(node.style.getPropertyValue("--available-height")) : -1; })()`);
      note(`${trigger}: after its content grew by 60px ${JSON.stringify(grown)}, room left ${room}px`);
      assert(room > 400, `${trigger}: the menu was measured against the overlay's edges, not the window's: only ${room}px of room`);
      const expected = trigger === "low" ? [x, y - 60, w, h + 60] : [x, y, w, h + 60];
      assert(JSON.stringify(grown.at?.(-1)) === JSON.stringify(expected.join(",")), `${trigger}: a menu that grew while shown was placed against the overlay's edges, not the window's: ${grown}`);
      }

      cockpit.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      await until(async () => !view.getVisible(), Boolean, `${trigger}: menu closed`);

    }
    console.log("OVERLAY_MENUS_OK");
  } finally {
    try { manager.destroy(); } catch {}
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
    await removeUserData(app.getPath("userData"));
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("OVERLAY_MENUS_FAIL", error);
    app.exit(1);
  },
);
