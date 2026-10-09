"use strict";

const MARGIN = 24;
const CARD_WIDTH = 680;
const WIDTH = CARD_WIDTH + 2 * MARGIN;
const MIN_HEIGHT = 120;
const COMPOSER_HEIGHT = 140;

const right = (area) => area.x + area.width;
const bottom = (area) => area.y + area.height;
const clampTo = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function anchorOn(display, offset) {
  const area = display.workArea;
  const x = offset ? area.x + offset.x : Math.round(area.x + (area.width - WIDTH) / 2);
  const y = offset ? area.y + offset.y : Math.round(area.y + area.height * 0.4);
  return { x: clampTo(x, area.x, right(area) - WIDTH), y: clampTo(y, area.y, bottom(area) - COMPOSER_HEIGHT) };
}

function displayFor(screen, held) {
  if (!held) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return screen.getAllDisplays().find((each) => each.id === held.display) ?? screen.getPrimaryDisplay();
}

function layout({ area, anchor, height, composerTop }) {
  const tall = clampTo(Math.ceil(height), MIN_HEIGHT, area.height);
  const x = clampTo(anchor.x, area.x, right(area) - WIDTH);
  const y = clampTo(anchor.y - composerTop, area.y, bottom(area) - tall);
  const composerAt = y + composerTop;
  return {
    bounds: { x, y, width: WIDTH, height: tall },
    room: { above: Math.max(0, composerAt - area.y - MARGIN), below: Math.max(0, bottom(area) - composerAt - COMPOSER_HEIGHT - MARGIN) },
  };
}

module.exports = { WIDTH, anchorOn, displayFor, layout };
