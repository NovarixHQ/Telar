const { screen } = require("electron");

const COMPACT_WIDTH = 480;
const COMPACT_MIN = { width: 240, height: 160 };
const FULL_MIN = { width: 360, height: 240 };
const MARGIN = 24;

const expandedBounds = new WeakMap();

function isCompact(win) {
  return expandedBounds.has(win);
}

function compactBounds(win) {
  const [width, height] = win.getContentSize();
  const ratio = width > 0 && height > 0 ? width / height : 16 / 10;
  const target = Math.min(COMPACT_WIDTH, width || COMPACT_WIDTH);
  const area = screen.getDisplayMatching(win.getNormalBounds()).workArea;
  const size = { width: target, height: Math.round(target / ratio) };
  return { ratio, bounds: { x: area.x + area.width - size.width - MARGIN, y: area.y + area.height - size.height - MARGIN, ...size } };
}

function floatOnTop(win, on) {
  win.setWindowButtonVisibility?.(!on);
  win.setAlwaysOnTop(on, "floating");
  win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on, skipTransformProcessType: true });
}

function setCompact(win, on, { place = true, expanded = null } = {}) {
  if (win.isDestroyed() || on === isCompact(win)) return;
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    const { ratio, bounds } = compactBounds(win);
    expandedBounds.set(win, expanded || win.getNormalBounds());
    win.setMinimumSize(COMPACT_MIN.width, COMPACT_MIN.height);
    if (place) win.setBounds(bounds);
    win.setAspectRatio(ratio);
    floatOnTop(win, true);
  } else {
    const back = expandedBounds.get(win);
    expandedBounds.delete(win);
    floatOnTop(win, false);
    win.setAspectRatio(0);
    win.setMinimumSize(FULL_MIN.width, FULL_MIN.height);
    if (back) win.setBounds(back);
  }
  win.emit("compact-changed");
}

function compactPlace(win) {
  return isCompact(win) ? { compact: true, expanded: expandedBounds.get(win) } : { compact: false };
}

module.exports = { FULL_MIN, compactPlace, isCompact, setCompact };
