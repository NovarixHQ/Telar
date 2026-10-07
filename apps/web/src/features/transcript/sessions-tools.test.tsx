import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { JournalItem } from "@/platform/engine";
import { TranscriptItem } from "./components/transcript-item";
import { TranscriptSession } from "./components/message-attachments";
import { tallyParts } from "./model";

const call = (tool: string, input: Record<string, unknown> = {}, over: Partial<JournalItem> = {}): JournalItem => ({
  id: `item_${tool}_${JSON.stringify(input)}`,
  runId: "run_1",
  sessionId: "session_1",
  status: "completed",
  startedAt: 1,
  completedAt: 2,
  streamedText: "",
  openedBy: 0,
  title: tool,
  detail: { type: "mcp_tool_call", call: { name: `mcp__telar__${tool}`, input } },
  ...over,
});

const withOutput = (item: JournalItem, output: unknown): JournalItem =>
  item.detail.type === "mcp_tool_call" ? { ...item, detail: { ...item.detail, call: { ...item.detail.call, output } } } : item;

const text = (item: JournalItem, hostId?: string) =>
  renderToStaticMarkup(
    <TranscriptSession.Provider value={{ sessionId: "session_1", ...(hostId ? { hostId } : {}) }}>
      <TranscriptItem item={item} />
    </TranscriptSession.Provider>,
  );
const visible = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("sessions tool rows", () => {
  test("a delegation reads in its tense, named once", () => {
    const create = call("sessions_create", { title: "Fix the rail", projectId: "p" });
    expect(visible(text(create))).toBe("Delegated “Fix the rail”");
    expect(visible(text({ ...create, status: "inProgress" }))).toContain("Delegating “Fix the rail”…");
  });

  test("a message reads as what it was for", () => {
    expect(visible(text(call("sessions_send", { intent: "task", message: "Go" })))).toContain("Tasked a session");
    expect(visible(text(call("sessions_send", { intent: "result", message: "Done" })))).toContain("Sent a result");
    expect(visible(text(call("sessions_send", { intent: "blocker", message: "Stuck" })))).toContain("Raised a blocker");
    expect(visible(text(call("sessions_send", { intent: "fyi", message: "FYI" })))).toContain("Sent a note");
  });

  test("the rest read as plain actions", () => {
    expect(visible(text(call("sessions_read", {}, { status: "inProgress" })))).toContain("Reading a session");
    expect(visible(text(call("sessions_list")))).toBe("Listed sessions");
    expect(visible(text(call("sessions_stop")))).toContain("Stopped a session");
    expect(visible(text(call("sessions_settle")))).toContain("Settled a session");
    expect(visible(text(call("sessions_subscribe")))).toContain("Subscribed to a session");
  });

  test("a tally counts each action in words", () => {
    const items = [
      call("sessions_create", { title: "One" }),
      call("sessions_create", { title: "Two" }),
      call("sessions_create", { title: "Three" }),
      call("sessions_send", { intent: "task", message: "a" }),
      call("sessions_send", { intent: "task", message: "b" }),
      call("sessions_read", { sessionId: "x" }),
      call("sessions_read", { sessionId: "y" }),
    ];
    expect(tallyParts(items)).toEqual(["Delegated 3 tasks", "Tasked 2 sessions", "Read 2 sessions"]);
    expect(tallyParts([call("sessions_create", { title: "Only" })])).toEqual(["Delegated “Only”"]);
  });

  test("a call that hands back a session's link opens it, through the host it came from", () => {
    const created = withOutput(call("sessions_create", { title: "Fix" }), JSON.stringify({ id: "s_a", link: "/projects/p/sessions/s_a" }));
    expect(text(created)).toContain('href="/projects/p/sessions/s_a"');
    expect(text(created, "mac2")).toContain('href="/hosts/mac2/projects/p/sessions/s_a"');
    const wrapped = withOutput(call("sessions_read"), { content: [{ type: "text", text: JSON.stringify({ link: "/projects/p/sessions/s_b" }) }] });
    expect(text(wrapped)).toContain('href="/projects/p/sessions/s_b"');
    expect(text(call("sessions_list"))).not.toContain("href=");
  });
});
