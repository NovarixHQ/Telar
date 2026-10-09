"use strict";

const MARGIN = 24;
const CARD_WIDTH = 680;
const WIDTH = CARD_WIDTH + 2 * MARGIN;
const MIN_HEIGHT = 120;
const LIFT = 0.22;

const right = (area) => area.x + area.width;
const bottom = (area) => area.y + area.height;
const clampTo = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function anchorOn(display, offset) {
  const area = display.workArea;
  const x = offset ? area.x + offset.x : Math.round(area.x + (area.width - WIDTH) / 2);
  const end = offset ? area.y + offset.bottom : Math.round(bottom(area) - area.height * LIFT + MARGIN);
  return { x: clampTo(x, area.x, right(area) - WIDTH), bottom: clampTo(end, area.y + MIN_HEIGHT, bottom(area)) };
}

function displayFor(screen, held) {
  if (!held) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return screen.getAllDisplays().find((each) => each.id === held.display) ?? screen.getPrimaryDisplay();
}

function layout({ area, anchor, height, composerTop }) {
  const x = clampTo(anchor.x, area.x, right(area) - WIDTH);
  const end = clampTo(anchor.bottom, area.y + MIN_HEIGHT, bottom(area));
  const tall = clampTo(Math.ceil(height), MIN_HEIGHT, end - area.y);
  const composerBlock = Math.max(0, height - composerTop);
  return { bounds: { x, y: end - tall, width: WIDTH, height: tall }, room: { above: Math.max(0, end - area.y - composerBlock - MARGIN) } };
}

module.exports = { WIDTH, anchorOn, displayFor, layout };
