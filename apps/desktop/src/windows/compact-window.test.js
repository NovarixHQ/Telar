const { afterEach, describe, expect, test } = require("bun:test");
const { FakeBrowserWindow, resetElectron } = require("../../test/fake-electron");
const { isCompact, setCompact } = require("./compact-window");

afterEach(() => resetElectron());

const windowAt = (bounds = { x: 100, y: 100, width: 1000, height: 600 }) => new FakeBrowserWindow(bounds);

describe("the compact, always-on-top mode", () => {
  test("floats above other apps and full-screen spaces without flickering the Dock", () => {
    const win = windowAt();
    setCompact(win, true);
    expect(isCompact(win)).toBe(true);
    expect(win.onTop).toBe("floating");
    expect(win.allWorkspaces).toEqual({ visibleOnFullScreen: true, skipTransformProcessType: true });
  });

  test("shrinks to a small window in the display's corner and keeps the page's proportions", () => {
    const win = windowAt();
    setCompact(win, true);
    expect(win.bounds).toEqual({ x: 1440 - 480 - 24, y: 25 + 875 - 288 - 24, width: 480, height: 288 });
    expect(win.aspectRatio).toBeCloseTo(1000 / 600);
    expect(win.minimumSize).toEqual([240, 160]);
  });

  test("turning it off puts the window back where it was, at its size, and no longer on top", () => {
    const win = windowAt();
    setCompact(win, true);
    setCompact(win, false);
    expect(isCompact(win)).toBe(false);
    expect(win.bounds).toEqual({ x: 100, y: 100, width: 1000, height: 600 });
    expect(win.onTop).toBe(false);
    expect(win.allWorkspaces).toBe(false);
    expect(win.allWorkspacesOptions).toMatchObject({ skipTransformProcessType: true });
    expect(win.aspectRatio).toBe(0);
  });

  test("a full-screen window leaves full screen first", () => {
    const win = windowAt();
    win.fullscreen = true;
    setCompact(win, true);
    expect(win.isFullScreen()).toBe(false);
  });

  test("a window reopened compact stays where it was and still knows where to go back to", () => {
    const win = windowAt({ x: 900, y: 500, width: 400, height: 250 });
    setCompact(win, true, { place: false, expanded: { x: 10, y: 40, width: 1200, height: 800 } });
    expect(win.bounds).toEqual({ x: 900, y: 500, width: 400, height: 250 });
    setCompact(win, false);
    expect(win.bounds).toEqual({ x: 10, y: 40, width: 1200, height: 800 });
  });

  test("says when it changed, so the window's place is written down", () => {
    const win = windowAt();
    let changes = 0;
    win.on("compact-changed", () => { changes += 1; });
    setCompact(win, true);
    setCompact(win, true);
    setCompact(win, false);
    expect(changes).toBe(2);
  });
});
