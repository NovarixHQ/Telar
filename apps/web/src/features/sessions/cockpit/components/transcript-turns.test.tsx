import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessageIntent, NotificationDetail } from "@telar/engine-client";
import type { JournalItem, JournalTurn } from "@/platform/engine";
import { SessionTurn } from "./session-turn";
import { TranscriptTurns } from "./transcript-turns";

const HOST = "session_host";
const TITLES: Record<string, string> = {
  session_solo_dddddd: "Answer a question",
  session_solo_eeeeee: "Check the docs",
};

const turn = (over: Partial<JournalTurn> & Pick<JournalTurn, "runId">): JournalTurn => ({
  prompt: "",
  origin: "user",
  state: "completed",
  resultText: "",
  items: [],
  tasks: [],
  ...over,
});

const notificationItem = (runId: string, notification: NotificationDetail): JournalItem => ({
  id: `notification_${runId}`, runId, sessionId: HOST, status: "completed", startedAt: 2, completedAt: 2, streamedText: "", openedBy: 0, title: notification.summary, detail: { type: "notification", notification },
});

function arrival(runId: string, from: string, intent: AgentMessageIntent, text: string): JournalTurn {
  const notification: NotificationDetail = {
    kind: "peer_message",
    sessionId: from,
    runId,
    intent,
    summary: `[agent message · ${intent}] session ${from} sent this session a ${intent} (run ${runId}, ${text.length} chars).`,
    fetch: { sessionId: HOST, runId },
    body: `[agent message · ${intent}] session ${from} sent this session a ${intent} (run ${runId}, ${text.length} chars).\nIn full:\n<<<\n${text}\n>>>`,
    ...(intent === "result" ? { spent: "claude-opus-5-5 at high effort, 120k tokens (100k cache read, 10k cache write, 8k in, 2k out)" } : {}),
  };
  const at = 20 + Number(runId.replace(/\D/g, "") || 0);
  return turn({ runId, origin: "session", sender: { sessionId: from }, agentIntent: intent, agentDelivery: "passive", prompt: text, notification, acceptedAt: at, items: [{ ...notificationItem(runId, notification), startedAt: at, completedAt: at }] });
}

const render = (turns: JournalTurn[], titles: Record<string, string> = TITLES) =>
  renderToStaticMarkup(
    <TranscriptTurns
      turns={turns}
      keep={new Set()}
      directory={new Map(Object.entries(titles).map(([id, title]) => [id, { title }]))}
      renderTurn={(each, view) => <SessionTurn turn={each} requests={[]} sending={false} live={false} onDecide={() => {}} {...(view.peerTitle ? { peerTitle: view.peerTitle } : {})} />}
    />,
  );

const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("arrivals outside any cohort", () => {
  test("consecutive ones fold into one line of titles", () => {
    const html = render([arrival("run_s1", "session_solo_dddddd", "result", "One."), arrival("run_s2", "session_solo_eeeeee", "result", "Two.")]);
    expect(html).toContain("2 updates · Answer a question, Check the docs");
    expect(html).not.toContain("A session sent a result");
  });

  test("an unknown session is never named by its id", () => {
    const html = render([arrival("run_s1", "session_stranger_ffffff", "result", "Hello.")], {});
    expect(html).toContain("A session sent a result");
    expect(visibleText(html)).not.toContain("ffffff");
  });
});
