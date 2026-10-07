const { afterEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSurfaceWindowStore, placeOnDisplays } = require("./surface-window-store");

const dirs = [];
function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-surface-windows-"));
  dirs.push(dir);
  return dir;
}
const manual = () => {
  const timers = [];
  return { timers, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => { timers.length = 0; } };
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const place = { bounds: { x: 100, y: 120, width: 900, height: 700 }, displayId: 2, fullscreen: false };

describe("the surface window store", () => {
  test("a remembered window is on disk for the next launch, and only once the write lands", () => {
    const dir = freshDir();
    const clock = manual();
    const store = createSurfaceWindowStore(dir, clock);
    store.remember("browser", "session-1", place);
    expect(fs.existsSync(store.file)).toBe(false);
    clock.timers.shift()();
    expect(createSurfaceWindowStore(dir).list("browser")).toEqual([{ kind: "browser", key: "session-1", ...place }]);
    expect(fs.readdirSync(dir)).toEqual(["surface-windows.json"]);
  });

  test("a window the person closed is forgotten", () => {
    const dir = freshDir();
    const store = createSurfaceWindowStore(dir, manual());
    store.remember("browser", "session-1", place);
    store.forget("browser", "session-1");
    store.flush();
    expect(createSurfaceWindowStore(dir).list("browser")).toEqual([]);
  });

  test("windows closing because the app quits stay remembered", () => {
    const dir = freshDir();
    const store = createSurfaceWindowStore(dir, manual());
    store.remember("browser", "session-1", place);
    store.holdForQuit();
    store.forget("browser", "session-1");
    expect(createSurfaceWindowStore(dir).get("browser", "session-1")).toMatchObject({ key: "session-1" });
  });

  test("a quit the person cancelled lets closing forget again", () => {
    const store = createSurfaceWindowStore(freshDir(), manual());
    store.remember("browser", "session-1", place);
    store.holdForQuit();
    store.release();
    store.forget("browser", "session-1");
    expect(store.list("browser")).toEqual([]);
  });

  test("an unreadable file or a malformed entry is skipped, not fatal", () => {
    const dir = freshDir();
    fs.writeFileSync(path.join(dir, "surface-windows.json"), "{not json");
    expect(createSurfaceWindowStore(dir).list("browser")).toEqual([]);
    fs.writeFileSync(path.join(dir, "surface-windows.json"), JSON.stringify({ version: 1, windows: [{ kind: "browser", key: "a", bounds: { x: 0, y: 0, width: 20, height: 20 } }, { kind: "browser", key: "b", bounds: place.bounds }] }));
    expect(createSurfaceWindowStore(dir).list("browser").map((entry) => entry.key)).toEqual(["b"]);
  });
});

describe("where a remembered window reopens", () => {
  const laptop = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  const monitor = { id: 2, workArea: { x: 1440, y: 0, width: 2560, height: 1440 } };

  test("on the same display and at the same size when that display is still there", () => {
    const saved = { bounds: { x: 1600, y: 100, width: 1200, height: 900 }, displayId: 2 };
    expect(placeOnDisplays(saved, [laptop, monitor], laptop)).toEqual(saved.bounds);
  });

  test("on the primary display, inside its work area, when its display is gone", () => {
    const saved = { bounds: { x: 1600, y: 100, width: 1200, height: 800 }, displayId: 2 };
    expect(placeOnDisplays(saved, [laptop], laptop)).toEqual({ x: 240, y: 100, width: 1200, height: 800 });
  });

  test("shrunk to fit a display smaller than the window", () => {
    const saved = { bounds: { x: 1500, y: 0, width: 2400, height: 1400 }, displayId: 2 };
    expect(placeOnDisplays(saved, [laptop], laptop)).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  test("on the display it overlaps most when its id changed", () => {
    const saved = { bounds: { x: 1500, y: 50, width: 800, height: 600 }, displayId: 9 };
    expect(placeOnDisplays(saved, [laptop, monitor], laptop)).toEqual({ x: 1500, y: 50, width: 800, height: 600 });
  });
});
