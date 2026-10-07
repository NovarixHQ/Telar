const { describe, expect, test } = require("bun:test");

const { ChordScopes } = require("./chord-scope");

const NINE = Array.from({ length: 9 }, (_, index) => `CommandOrControl+${index + 1}`);

describe("owners claim chords and every claim stays live (#660)", () => {
  test("nothing is claimed until somebody claims something", () => {
    const scopes = new ChordScopes();
    expect(scopes.of([{}, {}])).toEqual([]);
  });

  test("a page's claim does not erase the renderer's, and neither erases the other on release", () => {
    const scopes = new ChordScopes();
    const renderer = {};
    const browser = {};
    scopes.setOwner(renderer, ["CommandOrControl+K"]);
    scopes.setOwner(browser, NINE);
    expect(scopes.of([renderer, browser])).toEqual(["CommandOrControl+K", ...NINE]);

    scopes.setOwner(browser, []);
    expect(scopes.of([renderer, browser])).toEqual(["CommandOrControl+K"]);

    scopes.setOwner(browser, NINE);
    scopes.setOwner(renderer, []);
    expect(scopes.of([renderer, browser])).toEqual(NINE);
  });

  test("one window's claim is not read for another, and forgetting one leaves the other", () => {
    const scopes = new ChordScopes();
    const first = {};
    const second = {};
    scopes.setOwner(first, ["CommandOrControl+1"]);
    scopes.setOwner(second, ["CommandOrControl+2"]);
    expect(scopes.of([second])).toEqual(["CommandOrControl+2"]);

    expect(scopes.forget(first)).toBe(true);
    expect(scopes.of([first, second])).toEqual(["CommandOrControl+2"]);
    expect(scopes.forget(first)).toBe(false);
  });

  test("setOwner reports whether anything changed — a focus move between two tabs must not rebuild the menu", () => {
    const scopes = new ChordScopes();
    const browser = {};
    expect(scopes.setOwner(browser, NINE)).toBe(true);
    expect(scopes.setOwner(browser, NINE)).toBe(false);
    expect(scopes.setOwner(browser, [])).toBe(true);
    expect(scopes.setOwner(browser, [])).toBe(false);
  });

  test("duplicates across owners are reported once", () => {
    const scopes = new ChordScopes();
    const renderer = {};
    const browser = {};
    scopes.setOwner(renderer, ["CommandOrControl+1"]);
    scopes.setOwner(browser, ["CommandOrControl+1", "CommandOrControl+2"]);
    expect(scopes.of([renderer, browser])).toEqual(["CommandOrControl+1", "CommandOrControl+2"]);
  });

  test("junk over IPC reads as nothing claimed", () => {
    const scopes = new ChordScopes();
    const renderer = {};
    scopes.setOwner(renderer, undefined);
    expect(scopes.get(renderer)).toEqual([]);
    scopes.setOwner(renderer, "CommandOrControl+1");
    expect(scopes.get(renderer)).toEqual([]);
    scopes.setOwner(renderer, ["CommandOrControl+1", 7, null]);
    expect(scopes.get(renderer)).toEqual(["CommandOrControl+1"]);
    scopes.setOwner({}, { nine: true });
    expect(scopes.of([renderer])).toEqual(["CommandOrControl+1"]);
  });
});
