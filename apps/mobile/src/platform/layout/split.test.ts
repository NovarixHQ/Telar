import { describe, expect, test } from "bun:test";
import { selectionBase, splitColumns } from "./split";

const rail = { key: "rail-1", name: "Rail" };
const session = { key: "session-1", name: "Session" };
const panel = { key: "panel-1", name: "Panel" };

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
  const settings = { key: "settings-1", name: "Settings" };
  const isSheet = (route: { name: string }) => route.name === "Settings";

  test("the root stays in the sidebar and the rest goes to the detail column", () => {
    expect(splitColumns({ routes: [rail, session, panel], index: 2 }, isSheet)).toEqual({ sidebar: { routes: [rail], index: 0 }, detail: { routes: [session, panel], index: 1 } });
  });

  test("with nothing chosen the detail column is empty", () => {
    expect(splitColumns({ routes: [rail], index: 0 }, isSheet).detail).toBeUndefined();
  });

  test("a sheet opened from the sidebar stays over the sidebar instead of filling the detail column", () => {
    expect(splitColumns({ routes: [rail, settings], index: 1 }, isSheet)).toEqual({ sidebar: { routes: [rail, settings], index: 1 }, detail: undefined });
  });

  test("a sheet opened over a session stays with the session", () => {
    expect(splitColumns({ routes: [rail, session, settings], index: 2 }, isSheet)).toEqual({ sidebar: { routes: [rail], index: 0 }, detail: { routes: [session, settings], index: 1 } });
  });
});
