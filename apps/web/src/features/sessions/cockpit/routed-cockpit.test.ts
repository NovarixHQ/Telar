import { describe, expect, test } from "bun:test";
import { cockpitRoute } from "./routed-cockpit";

describe("cockpitRoute", () => {
  test("reads the ids off the address, local or on another Mac", () => {
    expect(cockpitRoute("/projects/p1/sessions/s%201")).toEqual({ projectId: "p1", sessionId: "s 1", solo: false });
    expect(cockpitRoute("/hosts/h/projects/p1/sessions/s1/solo")).toEqual({ projectId: "p1", sessionId: "s1", solo: true });
  });

  test("the new-conversation canvas has no session", () => {
    expect(cockpitRoute("/projects/p1/sessions/new")).toEqual({ projectId: "p1", sessionId: undefined, solo: false });
  });

  test("other addresses are not a cockpit", () => {
    expect(cockpitRoute("/settings")).toBeUndefined();
  });
});
