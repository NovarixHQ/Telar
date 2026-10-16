const OVERLAY_FRAME = "telar-overlay";

const layers = new WeakMap();
const watched = new WeakSet();

function closeLayer(win) {
  const layer = layers.get(win);
  if (!layer) return;
  layers.delete(win);
  try { if (!win.isDestroyed()) win.contentView.removeChildView(layer.view); } catch {}
  if (!layer.view.webContents.isDestroyed()) layer.view.webContents.close();
}

function layOut(win, layer) {
  const [width, height] = win.getContentSize();
  const key = `${width}x${height}`;
  if (layer.laidOut === key) return;
  layer.laidOut = key;
  layer.view.webContents.enableDeviceEmulation({
    screenPosition: "desktop",
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width, height },
    deviceScaleFactor: 0,
    scale: 1,
  });
}

function hide(win, layer) {
  if (!layer.shown) return;
  layer.shown = false;
  const hadKeys = layer.view.webContents.isFocused();
  layer.view.setVisible(false);
  if (hadKeys && !win.isDestroyed()) win.webContents.focus();
}

function setOverlayRect(win, rect) {
  const layer = layers.get(win);
  if (!layer || win.isDestroyed()) return;
  if (!rect) return hide(win, layer);
  const zoom = win.webContents.getZoomFactor();
  const bounds = {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.ceil(rect.width * zoom),
    height: Math.ceil(rect.height * zoom),
  };
  layer.view.setBounds(bounds);
  if (layer.shown) return;
  layer.shown = true;
  layer.shownAs = (layer.shownAs ?? 0) + 1;
  win.contentView.addChildView(layer.view);
  layer.view.setVisible(true);
  layer.view.webContents.focus();
}

function raiseOverlay(win) {
  const layer = layers.get(win);
  if (layer?.shown && !win.isDestroyed()) win.contentView.addChildView(layer.view);
}

function watchFocus(win, layer, onOutside) {
  const contents = layer.view.webContents;
  contents.on("blur", () => {
    if (!layer.shown) return;
    const shownAs = layer.shownAs;
    setImmediate(() => {
      if (layers.get(win) !== layer || !layer.shown || layer.shownAs !== shownAs || win.isDestroyed()) return;
      if (!win.isFocused() || contents.isFocused()) return;
      onOutside();
    });
  });
  const refocus = () => {
    if (layers.get(win) === layer && layer.shown && !contents.isDestroyed()) contents.focus();
  };
  win.on("focus", refocus);
  contents.once("destroyed", () => win.removeListener("focus", refocus));
}

function adoptOverlay(win, options) {
  closeLayer(win);
  const { WebContentsView } = require("electron");
  const view = new WebContentsView({ webContents: options.webContents, webPreferences: options.webPreferences });
  view.setBackgroundColor("#00000000");
  view.setVisible(false);
  win.contentView.addChildView(view);
  const layer = { view, shown: false };
  layers.set(win, layer);
  const [width, height] = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width, height });
  layOut(win, layer);
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  watchFocus(win, layer, () => {
    if (!win.webContents.isDestroyed()) win.webContents.send("telar:overlay:outside");
  });
  if (!watched.has(win)) {
    watched.add(win);
    win.once("closed", () => closeLayer(win));
    win.on("resize", () => {
      const current = layers.get(win);
      if (current) layOut(win, current);
    });
    win.webContents.on("did-start-loading", () => {
      const current = layers.get(win);
      if (current) hide(win, current);
    });
  }
  return view.webContents;
}

function validRect(rect) {
  if (rect === null) return null;
  const fields = [rect?.x, rect?.y, rect?.width, rect?.height];
  return fields.every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? rect : undefined;
}

function registerOverlayIpc() {
  const { BrowserWindow, ipcMain } = require("electron");
  ipcMain.on("telar:overlay:set-rect", (event, input) => {
    const rect = validRect(input);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (rect !== undefined && win) setOverlayRect(win, rect);
  });
}

module.exports = { OVERLAY_FRAME, adoptOverlay, raiseOverlay, registerOverlayIpc };
