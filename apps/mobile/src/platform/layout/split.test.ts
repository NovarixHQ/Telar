import { describe, expect, test } from "bun:test";
import { isRegularWidth, selectionBase, splitColumns } from "./split";

const rail = { key: "rail-1", name: "Rail" };
const session = { key: "session-1", name: "Session" };
const panel = { key: "panel-1", name: "Panel" };

describe("isRegularWidth", () => {
  test("an iPad full screen is regular in both orientations, a third of one is compact", () => {
    expect(isRegularWidth(1032, true)).toBe(true);
    expect(isRegularWidth(1376, true)).toBe(true);
    expect(isRegularWidth(375, true)).toBe(false);
  });

  test("an iPhone is compact except a Plus or Max in landscape", () => {
    expect(isRegularWidth(402, false)).toBe(false);
    expect(isRegularWidth(874, false)).toBe(false);
    expect(isRegularWidth(956, false)).toBe(true);
  });
});

describe("selectionBase", () => {
  const open = { routes: [rail, session, panel], index: 2 };

  test("a session chosen in the sidebar replaces the detail column", () => {
    const action = { type: "NAVIGATE", source: rail.key, payload: { name: "Session", params: { sessionId: "b" } } };
    expect(selectionBase(open, action, ["Session"])).toEqual({ routes: [rail], index: 0 });
  });

  test("a sheet opened from the sidebar stacks on top", () => {
    const action = { type: "NAVIGATE", source: rail.key, payload: { name: "Settings" } };
    expect(selectionBase(open, action, ["Session"])).toBe(open);
  });

  test("navigation from the detail column keeps its stack", () => {
    const action = { type: "NAVIGATE", source: session.key, payload: { name: "Session" } };
    expect(selectionBase(open, action, ["Session"])).toBe(open);
  });
});

describe("splitColumns", () => {
  test("the root stays in the sidebar and the rest goes to the detail column", () => {
    expect(splitColumns({ routes: [rail, session, panel], index: 2 })).toEqual({ sidebar: { routes: [rail], index: 0 }, detail: { routes: [session, panel], index: 1 } });
  });

  test("with nothing chosen the detail column is empty", () => {
    expect(splitColumns({ routes: [rail], index: 0 }).detail).toBeUndefined();
  });
});
