/**
 * The flat rail, rendered: children fold behind their parent's summary line,
 * and the one that needs the person is drawn anyway.
 */
import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { installTestDom } from "@/test/dom";

installTestDom();

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { FlatSessionList } = await import("./flat-session-list");
const { SidebarProvider } = await import("@/ui/sidebar");
import { flattenSessions } from "./flat-rail";
import type { SidebarSession } from "../session-list";

const session = (id: string, extra: Partial<SidebarSession> = {}): SidebarSession =>
  ({ id, title: `title-${id}`, projectId: "p1", projectName: "Telar", activity: "idle", createdAt: 1, updatedAt: 1, ...extra }) as SidebarSession;

function render(expanded: Set<string>): string {
  const entries = flattenSessions({
    pinned: [],
    sessions: [
      session("parent"),
      session("busy", { startedFrom: { sessionId: "parent" }, activity: "working" }),
      session("stuck", { startedFrom: { sessionId: "parent" }, activity: "blocked" }),
    ],
  });
  return renderToStaticMarkup(
    <SidebarProvider>
      <FlatSessionList
        entries={entries}
        expanded={expanded}
        onToggle={() => {}}
        renderedAt={0}
        bandFor={() => "active"}
        onRowChanged={() => {}}
        jumpSlot={() => undefined}
      />
    </SidebarProvider>,
  );
}

test("collapsed: the summary line, and only the child that needs the person", () => {
  const html = render(new Set());
  expect(html).toContain("2 sessions · 1 working · 1 needs you");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("title-stuck");
  expect(html).not.toContain("title-busy");
  // The project rides on the parent's card.
  expect(html).toContain("Telar");
});

test("expanded: every child under the parent", () => {
  const html = render(new Set(["parent"]));
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("title-busy");
  expect(html).toContain("title-stuck");
});

test("nested sessions are compact rows: their title alone, without the project or branch lines", () => {
  const entries = flattenSessions({
    pinned: [],
    sessions: [
      session("parent", { worktreeBranch: "telar/parent-branch" }),
      session("child", { startedFrom: { sessionId: "parent" }, projectName: "Orbit", worktreeBranch: "telar/child-branch" }),
    ],
  });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <SidebarProvider>
      <FlatSessionList
        entries={entries}
        expanded={new Set(["parent"])}
        onToggle={() => {}}
        renderedAt={0}
        bandFor={() => "active"}
        onRowChanged={() => {}}
        jumpSlot={() => undefined}
      />
    </SidebarProvider>,
  );
  const nested = host.querySelector('[role="group"][aria-label="Started from title-parent"]')!;
  const parent = host.querySelector("#sidebar-session-parent")!;
  expect(parent.textContent).toContain("Telar");
  expect(parent.textContent).toContain("telar/parent-branch");
  expect(nested.textContent).toContain("title-child");
  expect(nested.textContent).not.toContain("Orbit");
  expect(nested.textContent).not.toContain("telar/child-branch");
});
