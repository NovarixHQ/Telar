import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessageIntent, NotificationDetail, SessionChild } from "@telar/engine-client";
import type { JournalItem, JournalTurn } from "@telar/client/journal";
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
    expect(visibleText(withAgents([dispatch], [child("s_a", { state: "waiting" })]))).toContain("Waiting on you");
    expect(visibleText(withAgents([dispatch], [child("s_a", { state: "done", summary: "Merged it", endedAt: 2_000 })]))).toContain("Merged it");
  });

  test("several from one turn are one row that counts them, closed until opened", () => {
    const html = withAgents([dispatch], [child("s_a", { title: "One" }), child("s_b", { title: "Two" }), child("s_c", { title: "Three", state: "done", endedAt: 2_000 })]);
    expect(visibleText(html)).toContain("3 subagents");
    expect(visibleText(html)).toContain("2 working");
    expect(visibleText(html)).not.toContain("Three");
  });

  test("once every one has ended the group starts closed", () => {
    const html = withAgents([dispatch], [child("s_a", { title: "One", state: "done" }), child("s_b", { title: "Two", state: "failed" })]);
    expect(visibleText(html)).toContain("2 subagents");
    expect(visibleText(html)).toContain("1 failed");
    expect(visibleText(html)).not.toContain("One");
  });

  test("a child whose turn is not loaded shows under the newest turn while it is out, and not once it has ended", () => {
    const stray = child("s_a", { title: "Older errand", parentRunId: "run_unloaded" });
    const text = visibleText(withAgents([dispatch, later], [stray]));
    expect(text.indexOf("Older errand")).toBeGreaterThan(text.indexOf("turn:run_later"));
    expect(withAgents([dispatch, later], [{ ...stray, state: "done" }])).not.toContain("Older errand");
  });
});

function ending(runId: string, endings: { sessionId: string; state: "done" | "failed"; title: string; why?: string }[]): JournalTurn {
  const entries = endings.map(({ sessionId, state, title, why }) => ({
    kind: "wake" as const,
    sessionId,
    wakeKind: state === "failed" ? ("turn_failed" as const) : ("turn_completed" as const),
    title,
    summary: `[builder ${state}] "${title}" (${sessionId})${why ? ` — ${why}` : ""}`,
  }));
  const summary = entries.length > 1 ? `${entries.length} builders finished · …` : entries[0]!.summary;
  const notification: NotificationDetail = { kind: "wake", sessionId: entries.at(-1)!.sessionId, wakeKind: entries.at(-1)!.wakeKind, summary, fetch: { sessionId: HOST, runId }, body: summary, entries };
  return turn({ runId, origin: "provider", notification, items: [notificationItem(runId, notification)] });
}

describe("a builder's ending", () => {
  const renderEnding = (turns: JournalTurn[], agents: SessionChild[] = []) =>
    renderToStaticMarkup(
      <TranscriptTurns
        turns={turns}
        directory={new Map()}
        agents={agents}
        projectId="proj"
        renderTurn={(each) => <SessionTurn turn={each} requests={[]} sending={false} live={false} onDecide={() => {}} />}
      />,
    );

  test("reads as that builder's row, ended, not as a generic notice", () => {
    const html = renderEnding([ending("run_end", [{ sessionId: "s_a", state: "done", title: "Fix the rail", why: "Merged the fix" }])]);
    expect(visibleText(html)).toContain("Fix the rail");
    expect(visibleText(html)).toContain("Merged the fix");
    expect(html).toContain('data-agent-state="done"');
    expect(visibleText(html)).not.toContain("Session finished a turn");
  });

  test("several at once read as a group of ended rows", () => {
    const html = renderEnding(
      [ending("run_end", [{ sessionId: "s_a", state: "done", title: "One" }, { sessionId: "s_b", state: "failed", title: "Two", why: "tests fail" }])],
      [child("s_a", { state: "done", endedAt: 2_000 }), child("s_b", { state: "failed", endedAt: 3_000 })],
    );
    expect(visibleText(html)).toContain("2 subagents");
    expect(visibleText(html)).toContain("1 failed");
  });

  test("a builder already drawn under the turn that tasked it is not drawn again by its ending", () => {
    const html = renderEnding(
      [dispatch, ending("run_end", [{ sessionId: "s_a", state: "done", title: "Reply OK", why: "OK" }])],
      [child("s_a", { title: "Reply OK", state: "done", summary: "OK", endedAt: 24_000 })],
    );
    expect(html.match(/data-agent-state="done"/g)).toHaveLength(1);
  });
});

describe("two sub-agents and a builder from one turn", () => {
  const at = { runId: "run_dispatch", sessionId: HOST, startedAt: 1, streamedText: "", openedBy: 0 } as const;
  const spawn = (n: number): JournalItem => ({ ...at, id: `item_toolu_${n}`, status: "completed", completedAt: 5, title: `Agent ${n}`, detail: { type: "task", taskId: `task_${n}` } });
  const create: JournalItem = {
    ...at,
    id: "item_create",
    status: "completed",
    completedAt: 3,
    title: "sessions_create",
    detail: { type: "mcp_tool_call", call: { name: "mcp__telar__sessions_create", input: { title: "Reply OK" }, output: JSON.stringify({ link: "/projects/proj/sessions/s_ok" }) } },
  };
  const agentTask = (n: number, state: "running" | "completed") => ({ id: `task_${n}`, sessionId: HOST, runId: "run_dispatch", kind: "agent" as const, state, title: n === 1 ? "List files" : "Summarise README", startedAt: 1, updatedAt: 2, ...(state === "completed" ? { completedAt: 5 } : {}), items: [] });
  const fanOut = (state: "running" | "completed") =>
    turn({ runId: "run_dispatch", prompt: "Fan out", startedAt: 1, endedAt: 9, items: [spawn(1), spawn(2), create], tasks: [agentTask(1, state), agentTask(2, state)] });
  const builder = (state: "working" | "done") => child("s_ok", { title: "Reply OK", state, ...(state === "done" ? { summary: "OK", endedAt: 24_000 } : {}) });
  const draw = (turns: JournalTurn[], agents: SessionChild[]) =>
    renderToStaticMarkup(
      <TranscriptTurns
        turns={turns}
        directory={new Map()}
        agents={agents}
        projectId="proj"
        renderTurn={(each) => <SessionTurn turn={each} requests={[]} sending={false} live={false} onDecide={() => {}} />}
      />,
    );

  test("while they work they are one row outside the fold, and the builder is not drawn twice", () => {
    const text = visibleText(draw([fanOut("running")], [builder("working")]));
    expect(text).toContain("3 subagents");
    expect(text).toContain("3 working");
    expect(text).not.toContain("Started builder");
    expect(text.split("Reply OK").length - 1).toBeLessThanOrEqual(1);
  });

  test("the builder's result does not add a row of its own", () => {
    const text = visibleText(draw([fanOut("completed"), arrival("run_result", "s_ok", "result", "OK")], [builder("done")]));
    expect(text).not.toContain("sent a result");
    expect(text).not.toContain("subagents");
    expect(text).toContain("Worked for");
  });
});
