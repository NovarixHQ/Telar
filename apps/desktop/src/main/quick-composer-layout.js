"use strict";

const CARD_WIDTH = 680;
const MARGIN = 24;
const WIDTH = CARD_WIDTH + 2 * MARGIN;
const HEIGHTS = { compact: 236, expanded: 600 };
const LIFT = 0.22;

const right = (area) => area.x + area.width;
const bottom = (area) => area.y + area.height;
const clampTo = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function anchorOn(display, offset) {
  const area = display.workArea;
  const x = offset ? area.x + offset.x : Math.round(area.x + (area.width - WIDTH) / 2);
  const end = offset ? area.y + offset.bottom : Math.round(bottom(area) - area.height * LIFT);
  return { x, bottom: end };
}

function boundsFor({ area, anchor, mode }) {
  const width = Math.min(WIDTH, area.width);
  const height = Math.min(HEIGHTS[mode] ?? HEIGHTS.compact, area.height);
  const x = clampTo(anchor.x, area.x, right(area) - width);
  const end = clampTo(anchor.bottom, area.y + height, bottom(area));
  return { x, y: end - height, width, height };
}

module.exports = { HEIGHTS, WIDTH, anchorOn, boundsFor };
