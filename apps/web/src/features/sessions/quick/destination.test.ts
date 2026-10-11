import { describe, expect, test } from "bun:test";
import type { SidebarSession } from "../session-list";
import { destinationRows } from "./destination";

const session = (id: string, extra: Partial<SidebarSession> = {}) =>
  ({ id, title: `title-${id}`, projectId: "project_1", activity: "working", archived: false, driver: "claude", createdAt: 1, updatedAt: 1, ...extra }) as SidebarSession;

describe("the quick composer's # rows", () => {
  test("list top-level sessions only, never a builder another session started", () => {
    const rows = destinationRows("", [], [session("lead"), session("builder", { startedFrom: { sessionId: "lead" } })]);
    expect(rows.map((row) => (row.kind === "session" ? row.session.id : row.project.id))).toEqual(["lead"]);
  });
});
