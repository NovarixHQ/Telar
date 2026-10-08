import { expect, test } from "bun:test";
import type { NotificationDetail } from "@telar/engine-client";
import { agentNotice, notificationNotice, wakeNotice } from "./notices";

const detail = (over: Partial<NotificationDetail>): NotificationDetail => ({
  kind: "peer_message",
  summary: "[agent message · result] session session_aae8 sent this session a result",
  fetch: { sessionId: "s", runId: "r" },
  body: "The whole message",
  ...over,
});

test("a peer's result reads as a verb, its message head and the sender's short id", () => {
  expect(notificationNotice(detail({ intent: "result", sessionId: "session_aae8287d11b6924160" }), "OK")).toEqual({
    icon: "bell", verb: "A session sent a result", head: "OK", extra: ["session …924160"], body: "The whole message",
  });
});

test("without the message, the head is the summary minus its [kind] tag", () => {
  expect(notificationNotice(detail({})).head).toBe("session session_aae8 sent this session a result");
});

test("a finished turn names what happened and carries no head", () => {
  const notice = notificationNotice(detail({ kind: "wake", wakeKind: "turn_completed", sessionId: "session_x924160" }));
  expect(notice).toMatchObject({ verb: "Session finished a turn", extra: ["session …924160"] });
  expect(notice.head).toBeUndefined();
});

test("a wake and an agent's message read like the Swift rows", () => {
  expect(wakeNotice({ kind: "request_opened", sessionId: "s" } as never, undefined, undefined, "Run tests?").verb).toBe("Session asked a question");
  expect(wakeNotice(undefined, { task: false }, undefined, "").verb).toBe("The provider resumed on its own.");
  expect(wakeNotice(undefined, { task: true }, undefined, "").verb).toBe("A background task finished.");
  expect(agentNotice("fyi", "[fyi] heads up\nmore", "body")).toMatchObject({ verb: "FYI", head: "heads up", body: "body" });
});
