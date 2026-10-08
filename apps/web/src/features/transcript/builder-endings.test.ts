import { describe, expect, test } from "bun:test";
import type { NotificationDetail, NotificationEntry, WakeKind } from "@telar/engine-client";
import { builderEndings } from "./builder-endings";

const entry = (sessionId: string, state: "done" | "failed" | "stopped", title?: string, why?: string): NotificationEntry => {
  const wakeKind: WakeKind = state === "failed" ? "turn_failed" : state === "stopped" ? "turn_stopped" : "turn_completed";
  const line = `[builder ${state}] ${title ? `"${title}"` : sessionId} (${sessionId})${why ? ` — ${why}` : ""} · read it with sessions_read(sessionId: "${sessionId}", runId: "run_${sessionId}")`;
  return { kind: "wake", sessionId, runId: `run_${sessionId}`, wakeKind, summary: line, ...(title ? { title } : {}) };
};

const detail = (entries: NotificationEntry[], summary = entries[0]!.summary): NotificationDetail => ({
  kind: "wake",
  sessionId: entries[0]!.sessionId!,
  wakeKind: entries[0]!.wakeKind!,
  summary,
  fetch: { sessionId: entries[0]!.sessionId!, runId: "run_x" },
  body: summary,
  entries,
});

describe("builderEndings", () => {
  test("one builder's ending reads as its state, title and one line", () => {
    expect(builderEndings(detail([entry("s_a", "done", "Fix the rail", "Merged the fix")]))).toEqual([
      { sessionId: "s_a", state: "done", title: "Fix the rail", summary: "Merged the fix" },
    ]);
  });

  test("a merged notice reads as every builder in it", () => {
    const endings = builderEndings(detail([entry("s_a", "done", "One"), entry("s_b", "failed", "Two", "tests fail"), entry("s_c", "stopped")], "3 builders finished · …"));
    expect(endings).toEqual([
      { sessionId: "s_a", state: "done", title: "One" },
      { sessionId: "s_b", state: "failed", title: "Two", summary: "tests fail" },
      { sessionId: "s_c", state: "stopped" },
    ]);
  });

  test("anything else is not a builder ending", () => {
    const peer: NotificationDetail = { kind: "peer_message", sessionId: "s_a", intent: "result", summary: "[agent message · result] …", fetch: { sessionId: "h", runId: "r" }, body: "" };
    expect(builderEndings(peer)).toBeUndefined();
    const wake = { ...entry("s_b", "done"), summary: "Session finished a turn" };
    expect(builderEndings(detail([entry("s_a", "done"), wake]))).toBeUndefined();
  });
});
