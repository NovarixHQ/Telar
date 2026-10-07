import { describe, expect, test } from "bun:test";
import { NotificationDetail } from "@telar/engine-client";
import { childEndingNotification, mergeNotifications, wakeNotification } from "./notification";

const done = childEndingNotification({ sessionId: "session_a", title: "Settings mockup", state: "done", summary: "PR #1426 green", fetch: { sessionId: "session_host", runId: "run_result" } });
const failed = childEndingNotification({ sessionId: "session_b", title: "T3 research", state: "failed", summary: "timeout", fetch: { sessionId: "session_b", runId: "run_b" } });

describe("a builder's ending", () => {
  test("is one line naming where to read it", () => {
    expect(done.body).toBe('[builder done] "Settings mockup" (session_a) — PR #1426 green · read it with sessions_read(sessionId: "session_host", runId: "run_result")');
    expect(done).toMatchObject({ kind: "wake", wakeKind: "turn_completed", sessionId: "session_a", runId: "run_result" });
    expect(NotificationDetail.safeParse(done).success).toBe(true);
  });

  test("several held together read as one line per builder under a count", () => {
    const merged = mergeNotifications([done, failed]);
    expect(merged.body.split("\n")).toEqual([
      '2 builders finished · "Settings mockup" (done) · "T3 research" (failed: timeout). Read any with sessions_read.',
      `1. ${done.body}`,
      `2. ${failed.body}`,
    ]);
    expect(merged.entries?.map((entry) => entry.title)).toEqual(["Settings mockup", "T3 research"]);
  });

  test("held with other news, it is listed like any other", () => {
    const wake = wakeNotification({ wakeKind: "turn_completed", targetSessionId: "session_c", runId: "run_c", body: "[wake: completed] Session session_c" });
    expect(mergeNotifications([done, wake]).body).toStartWith("[engine notification · 2 things happened while this session was working]");
  });
});
