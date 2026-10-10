const { describe, expect, test } = require("bun:test");
const { HEIGHTS, WIDTH, anchorOn, boundsFor } = require("./quick-composer-layout");

const AREA = { x: 0, y: 25, width: 1440, height: 875 };
const SIDE = { x: 1440, y: 0, width: 1920, height: 1080 };
const LOW = Math.round(900 - 875 * 0.22);

describe("the window's bounds", () => {
  test("the two sizes share a bottom edge 22% of the display above its bottom, so expanding grows upward", () => {
    const anchor = anchorOn({ workArea: AREA }, null);
    const compact = boundsFor({ area: AREA, anchor, mode: "compact" });
    const expanded = boundsFor({ area: AREA, anchor, mode: "expanded" });
    expect(compact).toEqual({ x: Math.round((1440 - WIDTH) / 2), y: LOW - HEIGHTS.compact, width: WIDTH, height: HEIGHTS.compact });
    expect(expanded).toEqual({ ...compact, y: LOW - HEIGHTS.expanded, height: HEIGHTS.expanded });
  });

  test("stay inside the work area on every side, never clipped", () => {
    expect(boundsFor({ area: AREA, anchor: { x: -500, bottom: 9000 }, mode: "compact" })).toEqual({ x: 0, y: 900 - HEIGHTS.compact, width: WIDTH, height: HEIGHTS.compact });
    expect(boundsFor({ area: AREA, anchor: { x: 9000, bottom: 100 }, mode: "expanded" })).toEqual({ x: 1440 - WIDTH, y: 25, width: WIDTH, height: HEIGHTS.expanded });
  });

  test("on a display smaller than a size, take the whole work area rather than spill off it", () => {
    const small = { x: 0, y: 0, width: 600, height: 500 };
    expect(boundsFor({ area: small, anchor: anchorOn({ workArea: small }, null), mode: "expanded" })).toEqual({ x: 0, y: 0, width: 600, height: 500 });
  });

  test("a remembered offset wins over the default spot", () => {
    expect(anchorOn({ workArea: SIDE }, { x: 100, bottom: 600 })).toEqual({ x: 1540, bottom: 600 });
  });
});
