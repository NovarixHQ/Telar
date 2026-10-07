import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessageIntent, NotificationDetail, SessionChild } from "@telar/engine-client";
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

const child = (sessionId: string, over: Partial<SessionChild> = {}): SessionChild => ({ sessionId, parentSessionId: HOST, parentRunId: "run_dispatch", state: "working", startedAt: 1_000, ...over });

const dispatch = turn({ runId: "run_dispatch", prompt: "Fan these out" });
const later = turn({ runId: "run_later", prompt: "Anything else?" });

const withAgents = (turns: JournalTurn[], agents: SessionChild[]) =>
  renderToStaticMarkup(
    <TranscriptTurns
      turns={turns}
      directory={new Map()}
      agents={agents}
      projectId="proj"
      renderTurn={(each) => <p>{`turn:${each.runId}`}</p>}
    />,
  );

describe("children under the turn that tasked them", () => {
  test("a working child is a row after its turn, with what it is doing and a link to it", () => {
    const text = visibleText(withAgents([dispatch, later], [child("s_a", { title: "Fix the rail", progress: "Running tests", provider: "codex" })]));
    expect(text.indexOf("Fix the rail")).toBeGreaterThan(text.indexOf("turn:run_dispatch"));
    expect(text.indexOf("Fix the rail")).toBeLessThan(text.indexOf("turn:run_later"));
    expect(text).toContain("Running tests");
    expect(withAgents([dispatch], [child("s_a", { title: "Fix the rail" })])).toContain('href="/projects/proj/sessions/s_a"');
  });

  test("a waiting child says so, an ended one gives its summary", () => {
    expect(visibleText(withAgents([dispatch], [child("s_a", { state: "waiting" })]))).toContain("waiting on you");
    expect(visibleText(withAgents([dispatch], [child("s_a", { state: "done", summary: "Merged it", endedAt: 2_000 })]))).toContain("Merged it");
  });

  test("several from one turn share a header that counts them, open while any works", () => {
    const html = withAgents([dispatch], [child("s_a", { title: "One" }), child("s_b", { title: "Two" }), child("s_c", { title: "Three", state: "done", endedAt: 2_000 })]);
    expect(visibleText(html)).toContain("3 agents · 2 working · 1 done");
    expect(visibleText(html)).toContain("Three");
  });

  test("once every one has ended the group starts closed", () => {
    const html = withAgents([dispatch], [child("s_a", { title: "One", state: "done" }), child("s_b", { title: "Two", state: "failed" })]);
    expect(visibleText(html)).toContain("2 agents · 1 done · 1 failed");
    expect(visibleText(html)).not.toContain("One");
  });

  test("a child whose turn is not loaded shows under the newest turn while it is out, and not once it has ended", () => {
    const stray = child("s_a", { title: "Older errand", parentRunId: "run_unloaded" });
    const text = visibleText(withAgents([dispatch, later], [stray]));
    expect(text.indexOf("Older errand")).toBeGreaterThan(text.indexOf("turn:run_later"));
    expect(withAgents([dispatch, later], [{ ...stray, state: "done" }])).not.toContain("Older errand");
  });
});
