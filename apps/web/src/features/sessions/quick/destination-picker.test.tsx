import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SidebarSession } from "../session-list";
import { DestinationPicker } from "./destination-picker";

const session = (extra: Partial<SidebarSession>) =>
  ({ id: "s1", title: "Fix the build", projectId: "project_1", projectName: "Telar", activity: "idle", archived: false, driver: "claude", createdAt: 1, updatedAt: 1, ...extra }) as SidebarSession;

const row = (extra: Partial<SidebarSession>) =>
  renderToStaticMarkup(<DestinationPicker rows={[{ kind: "session", session: session(extra) }]} index={0} onPick={() => {}} manyHosts={false} />);

describe("a # session row", () => {
  test("shows its project's icon", () => {
    expect(row({ projectIcon: "k1" })).toContain('src="/api/projects/project_1/icon?v=k1"');
  });

  test("shows the project's initial when it has no icon", () => {
    const html = row({});
    expect(html).not.toContain("<img");
    expect(html).toContain(">T<");
  });
});
