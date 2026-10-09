const { describe, expect, test } = require("bun:test");
const { WIDTH, anchorOn, displayFor, layout } = require("./quick-composer-layout");

const AREA = { x: 0, y: 25, width: 1440, height: 875 };
const SIDE = { x: 1440, y: 0, width: 1920, height: 1080 };
const END = 900;

describe("the window's bounds", () => {
  test("keep the composer's bottom where it is, whatever grows above it", () => {
    const anchor = { x: 300, bottom: 700 };
    const small = layout({ area: AREA, anchor, height: 200, composerTop: 24 });
    const tall = layout({ area: AREA, anchor, height: 520, composerTop: 344 });
    expect(small.bounds).toEqual({ x: 300, y: 500, width: WIDTH, height: 200 });
    expect(tall.bounds).toEqual({ x: 300, y: 180, width: WIDTH, height: 520 });
    expect(small.bounds.y + small.bounds.height).toBe(tall.bounds.y + tall.bounds.height);
  });

  test("stay inside the work area on every side, capping the height rather than moving the composer", () => {
    expect(layout({ area: AREA, anchor: { x: -500, bottom: 9000 }, height: 300, composerTop: 24 }).bounds).toEqual({ x: 0, y: END - 300, width: WIDTH, height: 300 });
    expect(layout({ area: AREA, anchor: { x: 5000, bottom: 400 }, height: 900, composerTop: 24 }).bounds).toEqual({ x: 1440 - WIDTH, y: 25, width: WIDTH, height: 375 });
    expect(layout({ area: SIDE, anchor: { x: 9000, bottom: 0 }, height: 300, composerTop: 24 }).bounds).toMatchObject({ x: 1440 + 1920 - WIDTH, y: 0, height: 120 });
  });

  test("tell the page the room left above the composer", () => {
    expect(layout({ area: AREA, anchor: { x: 300, bottom: 700 }, height: 200, composerTop: 24 }).room).toEqual({ above: 700 - 25 - 176 - 24 });
  });
});

describe("where it opens", () => {
  test("centred with the composer's bottom 22% of the display above its bottom edge, or at a remembered offset", () => {
    expect(anchorOn({ workArea: AREA }, null)).toEqual({ x: Math.round((1440 - WIDTH) / 2), bottom: Math.round(END - 875 * 0.22 + 24) });
    expect(anchorOn({ workArea: SIDE }, { x: 100, bottom: 600 })).toEqual({ x: 1540, bottom: 600 });
    expect(anchorOn({ workArea: SIDE }, { x: 99999, bottom: 99999 })).toEqual({ x: 1440 + 1920 - WIDTH, bottom: 1080 });
  });

  test("on the remembered display while it exists, the primary when it is gone, the cursor's otherwise", () => {
    const displays = [{ id: 1, workArea: AREA }, { id: 2, workArea: SIDE }];
    const screen = {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays[0],
      getCursorScreenPoint: () => ({ x: 2000, y: 10 }),
      getDisplayNearestPoint: (point) => (point.x >= 1440 ? displays[1] : displays[0]),
    };
    expect(displayFor(screen, null).id).toBe(2);
    expect(displayFor(screen, { display: 1 }).id).toBe(1);
    expect(displayFor(screen, { display: 7 }).id).toBe(1);
  });
});
