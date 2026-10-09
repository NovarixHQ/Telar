"use strict";

const { anchorOn, displayFor, layout } = require("./quick-composer-layout");

const NUDGE_PX = 4;
const FIRST_METRICS = { height: 260, composerTop: 24 };

const everyFrame = (tick) => {
  const timer = setInterval(tick, 8);
  return () => clearInterval(timer);
};

function createPlacement({ screen, window: current, ticker = everyFrame }) {
  let place = null;
  let metrics = FIRST_METRICS;
  let applied = null;
  let stopFollowing = null;
  const live = () => {
    const win = current();
    return win && !win.isDestroyed() ? win : null;
  };

  const apply = () => {
    const win = live();
    if (!place || !win) return;
    const next = layout({ area: place.area, anchor: place.anchor, ...metrics });
    const same = applied && ["x", "y", "width", "height"].every((key) => applied.bounds[key] === next.bounds[key]);
    if (!same) win.setBounds(next.bounds, false);
    if (!same || applied.room.above !== next.room.above || applied.room.below !== next.room.below) win.webContents.send("telar:quick-composer:room", next.room);
    applied = next;
  };

  const settle = () => {
    const win = live();
    if (!place || !win) return;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    place = { display: display.id, area: display.workArea, anchor: { x: bounds.x, y: bounds.y + metrics.composerTop } };
    applied = null;
    apply();
  };

  const endDrag = () => {
    if (!stopFollowing) return;
    stopFollowing();
    stopFollowing = null;
    settle();
  };

  return {
    open(held) {
      const display = displayFor(screen, held);
      place = { display: display.id, area: display.workArea, anchor: anchorOn(display, held?.display === display.id ? held.offset : null) };
      metrics = FIRST_METRICS;
      applied = null;
      apply();
    },
    report({ height, composerTop } = {}) {
      if (!Number.isFinite(height) || !Number.isFinite(composerTop)) return;
      if (Math.abs(height - metrics.height) < NUDGE_PX && Math.abs(composerTop - metrics.composerTop) < NUDGE_PX) return;
      metrics = { height, composerTop };
      apply();
    },
    settle,
    startDrag({ offsetX, offsetY } = {}) {
      if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
      stopFollowing?.();
      stopFollowing = ticker(() => {
        const win = live();
        if (!win) return endDrag();
        const { x, y } = screen.getCursorScreenPoint();
        win.setPosition(Math.round(x - offsetX), Math.round(y - offsetY));
      });
    },
    endDrag,
    held: () => (place ? { display: place.display, offset: { x: place.anchor.x - place.area.x, y: place.anchor.y - place.area.y } } : null),
  };
}

module.exports = { FIRST_METRICS, createPlacement };
