const { describe, expect, test } = require("bun:test");
const { WIDTH, anchorOn, displayFor, layout } = require("./quick-composer-layout");

const AREA = { x: 0, y: 25, width: 1440, height: 875 };
const SIDE = { x: 1440, y: 0, width: 1920, height: 1080 };

describe("the window's bounds", () => {
  test("keep the composer where it is while the stack above grows the window upward", () => {
    const anchor = { x: 300, y: 500 };
    const small = layout({ area: AREA, anchor, height: 200, composerTop: 24 });
    const tall = layout({ area: AREA, anchor, height: 520, composerTop: 344 });
    expect(small.bounds).toEqual({ x: 300, y: 476, width: WIDTH, height: 200 });
    expect(tall.bounds).toEqual({ x: 300, y: 156, width: WIDTH, height: 520 });
    expect(small.bounds.y + 24).toBe(tall.bounds.y + 344);
  });

  test("stay inside the work area on every side", () => {
    expect(layout({ area: AREA, anchor: { x: -500, y: -500 }, height: 300, composerTop: 24 }).bounds).toMatchObject({ x: 0, y: 25 });
    expect(layout({ area: AREA, anchor: { x: 5000, y: 5000 }, height: 300, composerTop: 24 }).bounds).toMatchObject({ x: 1440 - WIDTH, y: 900 - 300 });
    expect(layout({ area: SIDE, anchor: { x: 9000, y: 40 }, height: 9000, composerTop: 24 }).bounds).toEqual({ x: 1440 + 1920 - WIDTH, y: 0, width: WIDTH, height: 1080 });
  });

  test("a stack too tall for the room above pushes the composer down rather than off the top", () => {
    const { bounds } = layout({ area: AREA, anchor: { x: 300, y: 200 }, height: 600, composerTop: 450 });
    expect(bounds.y).toBe(25);
  });

  test("tell the page how much room is left above and below the composer", () => {
    expect(layout({ area: AREA, anchor: { x: 300, y: 500 }, height: 200, composerTop: 24 }).room).toEqual({ above: 500 - 25 - 24, below: 900 - 500 - 140 - 24 });
  });
});

describe("where it opens", () => {
  test("centred at 40% of the display, or at a remembered offset clamped to it", () => {
    expect(anchorOn({ workArea: AREA }, null)).toEqual({ x: Math.round((1440 - WIDTH) / 2), y: Math.round(25 + 875 * 0.4) });
    expect(anchorOn({ workArea: SIDE }, { x: 100, y: 200 })).toEqual({ x: 1540, y: 200 });
    expect(anchorOn({ workArea: SIDE }, { x: 99999, y: 99999 })).toEqual({ x: 1440 + 1920 - WIDTH, y: 1080 - 140 });
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
