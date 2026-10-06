import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveSessionRow } from "@telar/engine-client";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionRow } = await import("./session-row");
const { SidebarProvider } = await import("@/ui/sidebar");
const { toSidebarSession } = await import("../session-list");

const NOW = 1_700_000_000_000;
const UNREAD = 'aria-label="Unread answer"';

const liveRow = (over: Record<string, unknown> = {}) =>
  LiveSessionRow.parse({
    id: "session_1",
    title: "Exoplanets",
    state: "active",
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    driver: "claude",
    workspace: { mode: "local", path: "/tmp/exoplanets" },
    envMode: "local",
    activity: "idle",
    lastTurnSequence: 2,
    lastReadTurnSequence: 1,
    ...over,
  });

const row = (over: Record<string, unknown> = {}, { active = false, variant = "slim" }: { active?: boolean; variant?: "card" | "slim" } = {}) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SessionRow
        session={toSidebarSession(liveRow(over), "exoplanets")}
        active={active}
        showProject={false}
        variant={variant}
        renderedAt={NOW}
        onRowChanged={() => {}}
      />
    </SidebarProvider>,
  );

describe("the rail marks a finished answer nobody has read", () => {
  test("a session whose newest answer is unread shows the dot, slim and card alike", () => {
    expect(row()).toContain(UNREAD);
    expect(row({}, { variant: "card" })).toContain(UNREAD);
  });

  test("the dot clears once the receipt reaches the newest answer", () => {
    expect(row({ lastReadTurnSequence: 2 })).not.toContain(UNREAD);
  });

  test("a session that has never answered shows no dot", () => {
    expect(row({ lastTurnSequence: undefined, lastReadTurnSequence: undefined })).not.toContain(UNREAD);
  });

  test("the open session shows no dot", () => {
    expect(row({}, { active: true })).not.toContain(UNREAD);
  });

  test("a builder filed under its orchestrator shows no dot of its own", () => {
    expect(row({ startedFrom: { sessionId: "session_orchestrator" } })).not.toContain(UNREAD);
  });

  test("a blocked or running session keeps its own indicator instead", () => {
    expect(row({ activity: "blocked" })).not.toContain(UNREAD);
    expect(row({ activity: "working" })).not.toContain(UNREAD);
    expect(row({ activity: "queued" })).not.toContain(UNREAD);
  });

  test("a woken session draws one dot, not two", () => {
    const html = row({ snoozedUntil: NOW - 60_000, snoozedAt: NOW - 120_000, wokeAt: NOW - 60_000 });
    expect(html).toContain('aria-label="Woke up"');
    expect(html).not.toContain(UNREAD);
  });
});
