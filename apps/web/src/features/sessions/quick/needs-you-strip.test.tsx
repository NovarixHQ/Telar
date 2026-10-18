import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SidebarSession } from "../session-list";
import { NeedsYouStrip } from "./needs-you-strip";

const session = (extra: Partial<SidebarSession>) =>
  ({ id: "s1", title: "Fix the build", projectId: "project_2", projectName: "exoplanets", activity: "blocked", archived: false, driver: "claude", createdAt: 1, updatedAt: 1, ...extra }) as SidebarSession;

const pill = (extra: Partial<SidebarSession>) =>
  renderToStaticMarkup(<NeedsYouStrip items={[{ kind: "waiting", session: session(extra) }]} strip={createRef()} manyHosts={false} onPick={() => {}} onLeave={() => {}} />);

describe("a needs-you pill", () => {
  test("shows its project's icon", () => {
    expect(pill({ projectIcon: "k2" })).toContain('src="/api/projects/project_2/icon?v=k2"');
  });

  test("fetches a remote project's icon through its host", () => {
    expect(pill({ projectIcon: "k9", hostId: "host_b" })).toContain('src="/api/engine/v2/hosts/host_b/api/projects/project_2/icon?v=k9"');
  });

  test("shows the project's initial when it has no icon", () => {
    const html = pill({});
    expect(html).not.toContain("<img");
    expect(html).toContain(">E<");
  });
});
