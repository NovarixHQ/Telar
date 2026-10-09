import { expect, test } from "bun:test";
import type { LiveSessionRow, RunView, SessionAssignment } from "@telar/engine-client";
import { coordinatorsOf, delegateDetail, delegatesOf, delegateState, sessionFacts, usageLine, workspaceProcesses } from "./agents";

const row = (id: string, extra: Partial<LiveSessionRow> = {}) => ({ id, title: id, activity: "idle", createdAt: 1, driver: "claude", ...extra }) as LiveSessionRow;
const task = (from: string, extra: Partial<SessionAssignment> = {}): SessionAssignment => ({ taskRunId: `t-${from}`, runId: `r-${from}`, fromSessionId: from, receivedAt: 10, ...extra });
const ago = (at: number) => `${at}@`;

test("a session's builders read tasked first, then finished, then started, then followed, each once", () => {
  const sessions = [row("me"), row("done"), row("busy", { activity: "working" }), row("child", { startedFrom: { sessionId: "me" } } as Partial<LiveSessionRow>), row("watched")];
  const assignments = { done: [task("me", { outcome: "completed", endedAt: 20 })], busy: [task("me", { scope: "fix tests" })] };
  const following = [{ id: "s1", subscriberSessionId: "me", targetSessionId: "watched", events: ["completed"], createdAt: 1 }, { id: "s2", subscriberSessionId: "me", targetSessionId: "busy", events: ["completed"], createdAt: 1 }] as never;
  const delegates = delegatesOf(sessions, assignments, "me", following);
  expect(delegates.map((entry) => [entry.session.id, entry.kind])).toEqual([["busy", "assigned"], ["done", "finished"], ["child", "started"], ["watched", "followed"]]);
  expect(delegates.map(delegateState).map((state) => state.label)).toEqual(["Working", "Done", "Idle", "Idle"]);
  expect(delegates.map((entry) => delegateDetail(entry, ago))).toEqual(["fix tests · 10@", "20@", "started from here · 1@", "following"]);
});

test("who a session works for: outstanding first, detached left out", () => {
  const assignments = { me: [task("old", { outcome: "completed", endedAt: 50 }), task("boss", { receivedAt: 5 }), task("gone", { outcome: "detached" })] };
  const coordinators = coordinatorsOf([row("boss")], assignments, "me");
  expect(coordinators.map((entry) => [entry.sessionId, entry.outstanding, !!entry.session])).toEqual([["boss", true, true], ["old", false, false]]);
});

test("the About card names the provider, model and effort, and the usage in tokens and dollars", () => {
  const session = row("me", { driver: "codex", model: { instanceId: "i", model: "gpt-5", effort: "high" }, usage: { tokens: { input: 1_200_000, output: 300_000, cacheRead: 0, cacheCreate: 0 }, costUsd: 1.5 } } as Partial<LiveSessionRow>);
  expect(sessionFacts(session, "Telar", undefined, ago)).toEqual([
    { label: "Agent", value: "Codex · gpt-5 · high" },
    { label: "Project", value: "Telar" },
    { label: "Started", value: "1@" },
    { label: "Usage", value: "1.5M tokens · $1.50" },
  ]);
  expect(usageLine({ tokens: { input: 4500, output: 0, cacheRead: 0, cacheCreate: 0 } })).toBe("4k tokens");
});

test("saved configurations show their terminal's state; other open terminals and background tasks follow", () => {
  const terminal = (id: string, status: RunView["status"], configId?: string) => ({ terminalId: id, title: id, command: `run ${id}`, status, activity: "idle", ...(configId ? { configId } : {}) }) as RunView;
  const processes = workspaceProcesses([{ id: "dev", name: "Dev", command: "bun dev" } as never], [terminal("t1", "ready", "dev"), terminal("t2", "running"), terminal("t3", "exited")], 2);
  expect(processes.map((process) => [process.title, process.state.label])).toEqual([["Dev", "Ready"], ["t2", "Running"], ["Background tasks", "Working"]]);
});
