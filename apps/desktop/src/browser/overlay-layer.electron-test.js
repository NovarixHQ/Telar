const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DesktopBrowserManager, createExternalLinkPolicy } = require("./browser-manager");
const { cockpitWindowOptions } = require("../main/cockpit-window");
const { applyExternalLinkPolicy } = require("../main/window-links");
const { registerOverlayIpc } = require("../windows/overlay-layer");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "telar-overlay-layer-")));

const TAB_RECT = { x: 0, y: 0, width: 1000, height: 700 };
const CARD = { x: 200, y: 150, width: 320, height: 200 };
const RECT = { x: 192, y: 142, width: 336, height: 216 };


const TAB_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tab</title>
<style>body{margin:0;background:#7255ba}</style></head><body><script>
  window.frames_ = 0; window.presses_ = [];
  (function tick(){ window.frames_++; requestAnimationFrame(tick); })();
  addEventListener('mousedown', (e) => window.presses_.push([e.clientX, e.clientY]));
</script></body></html>`;

const COCKPIT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cockpit</title>
<style>body{margin:0;background:#202020}</style></head><body>
<script>
  const CARD = ${JSON.stringify(CARD)}, RECT = ${JSON.stringify(RECT)};
  window.log_ = [];
  window.telarDesktop.overlay.onOutside(() => { log_.push('outside'); hide(); });
  function hide() { window.telarDesktop.overlay.setRect(null); }
  window.show = () => {
    const doc = window.open('', 'telar-overlay').document;
    doc.head.innerHTML = '<style>html,body{margin:0;background:transparent;overflow:hidden}</style>';
    doc.body.innerHTML = '<div style="transform:translate(' + -RECT.x + 'px,' + -RECT.y + 'px)"><div id="card" style="position:absolute;left:' + CARD.x + 'px;top:' + CARD.y + 'px;width:' + CARD.width + 'px;height:' + CARD.height + 'px;box-sizing:border-box;padding:16px;border-radius:14px;background:#fff"><input id="field"></div></div>';
    const field = doc.getElementById('field');
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) field.addEventListener(type, (e) => log_.push(type + ':' + e.data));
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { log_.push('escape'); hide(); } });
    window.telarDesktop.overlay.setRect(RECT);
    return [innerWidth, innerHeight];
  };
  window.overlaySize = () => { const w = window.open('', 'telar-overlay'); return [w.innerWidth, w.innerHeight]; };
</script></body></html>`;

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (line) => console.log(`OVERLAY_LAYER ${line}`);
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }
async function until(read, accept, label, tries = 60) {
  let value;
  for (let i = 0; i < tries; i += 1) {
    value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error(`${label}: last value ${JSON.stringify(value)}`);
}

function pixel(image, x, y, cssWidth) {
  const size = image.getSize();
  const scale = size.width / cssWidth;
  const bitmap = image.toBitmap();
  const o = (Math.round(y * scale) * size.width + Math.round(x * scale)) * 4;
  return [bitmap[o + 2], bitmap[o + 1], bitmap[o], bitmap[o + 3]];
}

async function frameRate(wc) {
  const a = await wc.executeJavaScript("window.frames_");
  await delay(500);
  return (await wc.executeJavaScript("window.frames_")) - a;
}

async function main() {
  registerOverlayIpc();
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.url.startsWith("/tab") ? TAB_PAGE : COCKPIT_PAGE);
  });
  const base = `http://127.0.0.1:${await listen(server)}`;

  const win = new BrowserWindow({ ...cockpitWindowOptions("overlay layer"), show: false, width: 1200, height: 800 });
  applyExternalLinkPolicy(win.webContents, () => createExternalLinkPolicy({ appUrl: `${base}/` }));
  const manager = new DesktopBrowserManager(win);
  try {
    await win.loadURL(`${base}/`);
    app.focus({ steal: true });
    win.show();
    win.focus();
    const cockpit = win.webContents;
    const log = () => cockpit.executeJavaScript("JSON.stringify(log_)").then(JSON.parse);

    manager.declareProfile("s", "none");
    manager.setBounds("s", TAB_RECT);
    await manager.setVisible("s", true);
    await manager.action("s", { action: "new", url: `${base}/tab` });
    const tab = () => manager.activeTab("s").view.webContents;
    await until(() => tab().executeJavaScript("document.readyState"), (s) => s === "complete", "tab load");

    const fresh = await cockpit.executeJavaScript("overlaySize()");
    const cockpitSize = await cockpit.executeJavaScript("[innerWidth, innerHeight]");
    await until(() => cockpit.executeJavaScript("overlaySize()"), (s) => s.join() === cockpitSize.join(), `a new overlay lays out at the cockpit's size (first read ${fresh})`);
    await cockpit.executeJavaScript("show()");
    const view = await until(async () => win.contentView.children.at(-1), (v) => v?.getVisible?.() && v.webContents !== tab(), "overlay view");
    const overlay = view.webContents;
    assert(overlay.getOSProcessId() === cockpit.getOSProcessId(), "the overlay is not in the cockpit's renderer");
    assert(JSON.stringify(view.getBounds()) === JSON.stringify(RECT), `overlay bounds ${JSON.stringify(view.getBounds())}`);
    const overlaySize = await until(() => overlay.executeJavaScript("[innerWidth, innerHeight]"), (s) => s.join() === cockpitSize.join(), "overlay viewport");
    note(`the overlay covers only ${JSON.stringify(RECT)} and still lays out at the cockpit's ${overlaySize.join("×")}`);

    const fps = await frameRate(tab());
    note(`the page underneath keeps animating: ${fps * 2}fps`);
    assert(fps > 20, "the page stopped animating under the overlay");

    const shot = await until(() => overlay.capturePage(), (image) => !image.isEmpty() && pixel(image, CARD.x - RECT.x + 160, CARD.y - RECT.y + 100, RECT.width)[3] === 255, "overlay painted");
    const corner = pixel(shot, CARD.x - RECT.x, CARD.y - RECT.y, RECT.width);
    note(`card corner RGBA=${corner}`);
    assert(corner[3] === 0, `the card's rounded corner is not transparent (${corner})`);

    await until(async () => overlay.isFocused(), Boolean, "showing the overlay hands it the keys");
    await overlay.executeJavaScript("document.getElementById('field').focus()");
    for (const key of ["H", "i"]) {
      overlay.sendInputEvent({ type: "keyDown", keyCode: key });
      overlay.sendInputEvent({ type: "char", keyCode: key });
      overlay.sendInputEvent({ type: "keyUp", keyCode: key });
    }
    overlay.debugger.attach("1.3");
    await overlay.debugger.sendCommand("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
    await overlay.debugger.sendCommand("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
    await overlay.debugger.sendCommand("Input.insertText", { text: "日本" });
    overlay.debugger.detach();
    const typed = await until(() => overlay.executeJavaScript("document.getElementById('field').value"), (v) => v === "Hi日本", "typing");
    note(`typed ${typed}; ${(await log()).filter((e) => e.startsWith("composition")).join(" ")}`);
    assert((await log()).includes("compositionend:日本"), "IME composition did not end in the overlay");

    overlay.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await until(async () => !view.getVisible(), Boolean, "escape hides the overlay");
    await until(async () => cockpit.isFocused(), Boolean, "focus returns to the cockpit");
    note("escape hides the overlay and gives keys back to the cockpit");
    const resting = await until(() => cockpit.executeJavaScript("overlaySize()"), (s) => s.join() === cockpitSize.join(), "hidden overlay at cockpit size");
    note(`hidden, the overlay lays out at the cockpit's ${resting.join("×")}`);

    await cockpit.executeJavaScript("show()");
    await until(async () => view.getVisible(), Boolean, "reopen");
    await until(async () => overlay.isFocused(), Boolean, "overlay focused again");
    manager.noteHumanInputFromWebContents(tab(), "pointerdown");
    tab().focus();
    await until(log, (entries) => entries.includes("outside"), "a press on the page closes the overlay");
    await until(async () => !view.getVisible(), Boolean, "outside hides the overlay");
    note("focus moving to the page in the same window closes the overlay");

    await cockpit.executeJavaScript("show()");
    await until(async () => view.getVisible(), Boolean, "reopen");
    await manager.action("s", { action: "new", url: `${base}/tab?2` });
    assert(win.contentView.children.at(-1) === view, "a new tab buried the overlay");
    note("a new tab mounts under the overlay");

    cockpit.reload();
    await until(async () => !view.getVisible(), Boolean, "a cockpit reload hides the overlay");
    await new Promise((resolve) => cockpit.once("did-finish-load", resolve));
    await cockpit.executeJavaScript("show()");
    const again = await until(async () => win.contentView.children.at(-1), (v) => v?.getVisible?.() && v.webContents !== tab(), "overlay after reload");
    assert(win.contentView.children.filter((child) => child === again).length === 1, "overlay view duplicated after reload");
    note("after a reload the cockpit gets an overlay again");
    console.log("OVERLAY_LAYER_OK");
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
    console.error("OVERLAY_LAYER_FAIL", error);
    app.exit(1);
  },
);
