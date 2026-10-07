const { afterEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { electron, FakeBrowserWindow, resetElectron, userData } = require("../../test/fake-electron");
const { createCockpitWindow } = require("../main/cockpit-window");
const { adoptMainWindow, mainWindow, windowPlace, windowToFocus } = require("./main-window");

const laptop = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const monitor = { id: 2, workArea: { x: 1440, y: 0, width: 2560, height: 1440 } };
const prefsFile = path.join(userData, "main-window.json");

function saveBounds(saved) {
  fs.writeFileSync(prefsFile, JSON.stringify(saved));
}

function fakeTimers() {
  const pending = new Map();
  let next = 0;
  return {
    setTimer: (fn) => (pending.set(++next, fn), next),
    clearTimer: (id) => pending.delete(id),
    pending: () => pending.size,
    run() {
      const due = [...pending.values()];
      pending.clear();
      for (const fn of due) fn();
    },
  };
}

function openCockpit(main) {
  return createCockpitWindow("http://127.0.0.1:42731/", {
    main,
    createManager: (window) => ({ window, extensionHosts: new Map(), windowOfSender: () => null, hideVisibleScope() {}, destroy() {} }),
    onInPageNavigation: () => {},
  });
}

afterEach(() => {
  for (const win of FakeBrowserWindow.getAllWindows()) win.close();
  fs.rmSync(prefsFile, { force: true });
  resetElectron();
});

describe("the main window comes back where it was left", () => {
  test("saved bounds on a display that is still attached are used as they are", () => {
    electron.screen.displays = [laptop, monitor];
    saveBounds({ bounds: { x: 1600, y: 100, width: 1500, height: 900 }, displayId: 2 });
    const win = openCockpit(true);
    expect(win.getNormalBounds()).toEqual({ x: 1600, y: 100, width: 1500, height: 900 });
  });

  test("when that display is gone it opens at the default size centred on the primary display", () => {
    electron.screen.displays = [laptop];
    saveBounds({ bounds: { x: 1600, y: 100, width: 1500, height: 900 }, displayId: 2 });
    expect(windowPlace(true).bounds).toEqual({ x: 80, y: 63, width: 1280, height: 800 });
  });

  test("bounds that no longer touch the display's work area fall back the same way", () => {
    electron.screen.displays = [laptop, monitor];
    saveBounds({ bounds: { x: 9000, y: 9000, width: 1200, height: 800 }, displayId: 2 });
    expect(windowPlace(true).bounds).toEqual({ x: 80, y: 63, width: 1280, height: 800 });
  });

  test("a first launch with nothing saved is centred on the primary display", () => {
    expect(windowPlace(true).bounds).toEqual({ x: 80, y: 63, width: 1280, height: 800 });
  });

  test("a maximized main window is maximized again once it can show", () => {
    saveBounds({ bounds: { x: 0, y: 25, width: 1440, height: 875 }, displayId: 1, maximized: true });
    const win = openCockpit(true);
    expect(win.isMaximized()).toBe(false);
    win.emit("ready-to-show");
    expect(win.isMaximized()).toBe(true);
  });
});

describe("the main window remembers where it is", () => {
  test("moves and resizes are saved once they settle", () => {
    electron.screen.displays = [laptop, monitor];
    const timers = fakeTimers();
    const win = new FakeBrowserWindow({ x: 100, y: 100, width: 1280, height: 800 });
    adoptMainWindow(win, windowPlace(true), timers);
    win.setBounds({ x: 1500, y: 40 });
    win.emit("move");
    win.emit("resize");
    expect(timers.pending()).toBe(1);
    expect(fs.existsSync(prefsFile)).toBe(false);
    timers.run();
    expect(windowPlace(true).bounds).toEqual({ x: 1500, y: 40, width: 1280, height: 800 });
  });

  test("closing saves straight away", () => {
    const timers = fakeTimers();
    const win = new FakeBrowserWindow({ x: 200, y: 120, width: 1000, height: 700 });
    adoptMainWindow(win, windowPlace(true), timers);
    win.emit("move");
    win.emit("close");
    expect(timers.pending()).toBe(0);
    expect(windowPlace(true).bounds).toEqual({ x: 200, y: 120, width: 1000, height: 700 });
  });

  test("other cockpit windows never touch the saved place", () => {
    const win = openCockpit(false);
    win.emit("close");
    expect(fs.existsSync(prefsFile)).toBe(false);
  });
});

describe("a new window opens where the person is looking", () => {
  test("it is centred on the display under the cursor at the default size", () => {
    electron.screen.displays = [laptop, monitor];
    electron.screen.cursor = { x: 2000, y: 300 };
    const win = openCockpit(false);
    expect(win.getNormalBounds()).toEqual({ x: 2080, y: 320, width: 1280, height: 800 });
  });
});

describe("a second launch focuses the main window", () => {
  test("it picks the main window even when another cockpit window came first", () => {
    const other = openCockpit(false);
    const main = openCockpit(true);
    expect(windowToFocus(mainWindow(), [other, main])).toBe(main);
  });

  test("with the main window closed it falls back to another cockpit window", () => {
    const main = openCockpit(true);
    const other = openCockpit(false);
    main.close();
    expect(mainWindow()).toBeNull();
    expect(windowToFocus(mainWindow(), [main, other])).toBe(other);
  });
});
