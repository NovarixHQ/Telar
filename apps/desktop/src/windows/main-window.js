const { screen } = require("electron");
const { jsonPrefs } = require("../main/prefs");

const DEFAULT_SIZE = { width: 1280, height: 800 };
const SAVE_DELAY_MS = 400;

function cleanSaved(value) {
  const bounds = value?.bounds;
  const numbers = [bounds?.x, bounds?.y, bounds?.width, bounds?.height, value?.displayId];
  if (!numbers.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw new Error("invalid main window bounds");
  const { x, y, width, height } = bounds;
  return { bounds: { x, y, width, height }, displayId: value.displayId, maximized: value.maximized === true, fullscreen: value.fullscreen === true };
}

const mainWindowPrefs = jsonPrefs("main-window.json", null, cleanSaved, "main window bounds");

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function centredIn(area) {
  const width = Math.min(DEFAULT_SIZE.width, area.width);
  const height = Math.min(DEFAULT_SIZE.height, area.height);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}

function restoredPlace(saved, displays, primary) {
  const display = saved && displays.find((candidate) => candidate.id === saved.displayId);
  if (display && intersects(saved.bounds, display.workArea)) return saved;
  return { bounds: centredIn(primary.workArea), maximized: false, fullscreen: false };
}

function windowPlace(main, prefs = mainWindowPrefs) {
  if (main) return restoredPlace(prefs.read(), screen.getAllDisplays(), screen.getPrimaryDisplay());
  return { bounds: centredIn(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea), maximized: false, fullscreen: false };
}

let current = null;

function mainWindow() {
  return current && !current.isDestroyed() ? current : null;
}

function windowToFocus(main, cockpitWindows) {
  return [main, ...cockpitWindows].find((win) => win && !win.isDestroyed()) ?? null;
}

function adoptMainWindow(win, place, { prefs = mainWindowPrefs, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  current = win;
  let timer = null;
  const save = () => {
    clearTimer(timer);
    timer = null;
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    prefs.write({ bounds, displayId: screen.getDisplayMatching(bounds).id, maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  };
  const schedule = () => {
    clearTimer(timer);
    timer = setTimer(save, SAVE_DELAY_MS);
  };
  for (const event of ["move", "resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(event, schedule);
  win.on("close", save);
  win.on("closed", () => {
    clearTimer(timer);
    if (current === win) current = null;
  });
  win.once("ready-to-show", () => {
    if (place.fullscreen) win.setFullScreen(true);
    else if (place.maximized) win.maximize();
  });
}

module.exports = { adoptMainWindow, mainWindow, windowPlace, windowToFocus };
