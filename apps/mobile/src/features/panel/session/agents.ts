import type { AssignmentOutcome, LiveSessionRow, RunConfigurationView, RunView, SessionAssignment, SessionChild, Subscription, UsageSnapshot } from "@telar/engine-client";

export type Tone = "live" | "attention" | "done" | "danger" | "quiet";
export type State = { label: string; tone: Tone };
type Assignments = Readonly<Record<string, SessionAssignment[] | undefined>>;

export type Delegate = { session: LiveSessionRow; kind: "assigned" | "finished" | "started" | "followed"; scope?: string | undefined; outcome?: AssignmentOutcome | undefined; at?: number | undefined };
export type Coordinator = { id: string; sessionId: string; session?: LiveSessionRow | undefined; scope?: string | undefined; outcome?: AssignmentOutcome | undefined; at?: number | undefined; outstanding: boolean; unresolved: boolean };

const outstanding = (assignment: SessionAssignment) => assignment.outcome === undefined && !assignment.unresolved;
const ended = (assignment: SessionAssignment) => assignment.outcome !== undefined && assignment.outcome !== "detached";

/** The sessions this one works with: those it tasked, those it started, then those it follows. */
export function delegatesOf(sessions: readonly LiveSessionRow[], assignments: Assignments, coordinator: string, following: readonly Subscription[] = []): Delegate[] {
  const out: Delegate[] = [];
  const seen = new Set([coordinator]);
  const add = (delegate: Delegate) => {
    if (seen.has(delegate.session.id)) return;
    seen.add(delegate.session.id);
    out.push(delegate);
  };
  const mine = (session: LiveSessionRow) => (assignments[session.id] ?? []).filter((assignment) => assignment.fromSessionId === coordinator);
  for (const session of sessions) {
    const errand = mine(session).find(outstanding);
    if (errand) add({ session, kind: "assigned", scope: errand.scope, at: errand.receivedAt });
  }
  for (const session of sessions) {
    const errand = mine(session).findLast(ended);
    if (errand) add({ session, kind: "finished", scope: errand.scope, outcome: errand.outcome, at: errand.endedAt });
  }
  for (const session of sessions) if (session.startedFrom?.sessionId === coordinator) add({ session, kind: "started", at: session.createdAt });
  for (const subscription of following) {
    const session = sessions.find((candidate) => candidate.id === subscription.targetSessionId);
    if (session) add({ session, kind: "followed" });
  }
  return out;
}

/** The sessions that handed this one work, outstanding first, then newest. */
export function coordinatorsOf(sessions: readonly LiveSessionRow[], assignments: Assignments, sessionId: string): Coordinator[] {
  const held = (assignments[sessionId] ?? []).filter((assignment) => assignment.outcome !== "detached");
  return held
    .map((assignment, index) => ({
      id: `${index}:${assignment.fromSessionId}`,
      sessionId: assignment.fromSessionId,
      session: sessions.find((session) => session.id === assignment.fromSessionId),
      scope: assignment.scope,
      outcome: assignment.outcome,
      at: assignment.endedAt ?? assignment.receivedAt,
      outstanding: outstanding(assignment),
      unresolved: assignment.unresolved === true,
    }))
    .sort((left, right) => (left.outstanding !== right.outstanding ? (left.outstanding ? -1 : 1) : (right.at ?? 0) - (left.at ?? 0)));
}

const OUTCOME_LABEL: Record<AssignmentOutcome, string> = { completed: "Done", failed: "Failed", stopped: "Stopped", detached: "Detached" };
const outcomeState = (outcome: AssignmentOutcome): State => ({ label: OUTCOME_LABEL[outcome], tone: outcome === "completed" ? "done" : outcome === "failed" ? "danger" : "quiet" });

export function delegateState(entry: Delegate): State {
  if (entry.kind === "finished" && entry.outcome) return outcomeState(entry.outcome);
  switch (entry.session.activity) {
    case "blocked":
      return { label: "Needs you", tone: "attention" };
    case "working":
      return { label: "Working", tone: "live" };
    case "queued":
      return { label: "Queued", tone: "live" };
    case "monitoring":
      return { label: "Monitoring", tone: "live" };
    default:
      return { label: entry.kind === "assigned" ? "Working" : "Idle", tone: "quiet" };
  }
}

const joined = (parts: (string | undefined)[]) => parts.filter((part): part is string => !!part).join(" · ") || undefined;

export function delegateDetail(entry: Delegate, ago: (at: number) => string): string | undefined {
  const lead = entry.scope || (entry.kind === "started" ? "started from here" : entry.kind === "followed" ? "following" : undefined);
  return joined([lead, entry.at === undefined ? undefined : ago(entry.at)]);
}

const CHILD: Record<SessionChild["state"], State> = {
  working: { label: "Working", tone: "live" },
  waiting: { label: "Asking", tone: "attention" },
  done: { label: "Done", tone: "done" },
  failed: { label: "Failed", tone: "danger" },
  stopped: { label: "Stopped", tone: "quiet" },
};
export const childState = (child: SessionChild): State => CHILD[child.state];

export const childDetail = (child: SessionChild, ago: (at: number) => string) => joined([child.endedAt === undefined ? child.progress : child.summary, ago(child.endedAt ?? child.startedAt)]);

export function coordinatorState(entry: Coordinator): State {
  if (entry.outcome) return outcomeState(entry.outcome);
  if (entry.unresolved) return { label: "Unknown", tone: "quiet" };
  return { label: "Assigned", tone: entry.outstanding ? "live" : "quiet" };
}

export const coordinatorDetail = (entry: Coordinator, ago: (at: number) => string) =>
  joined([entry.scope, entry.unresolved ? "state unknown" : undefined, entry.at === undefined ? undefined : ago(entry.at), entry.session ? undefined : "no longer listed"]);

const capitalized = (text: string) => text.replace(/\w\S*/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());

export function usageLine(usage: UsageSnapshot): string {
  const { input, output, cacheRead, cacheCreate } = usage.tokens;
  const total = input + output + cacheRead + cacheCreate;
  const tokens = total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M tokens` : `${Math.floor(total / 1000)}k tokens`;
  return usage.costUsd === undefined ? tokens : `${tokens} · $${usage.costUsd.toFixed(2)}`;
}

export type Fact = { label: string; value: string };

export function sessionFacts(session: LiveSessionRow, project: string | undefined, host: string | undefined, ago: (at: number) => string): Fact[] {
  const agent = [capitalized(session.driver), session.model?.model, session.model?.effort].filter(Boolean).join(" · ");
  return [
    { label: "Agent", value: agent },
    ...(project ? [{ label: "Project", value: project }] : []),
    ...(host ? [{ label: "Computer", value: host }] : []),
    { label: "Started", value: ago(session.createdAt) },
    ...(session.usage ? [{ label: "Usage", value: usageLine(session.usage) }] : []),
  ];
}

export type Process = { id: string; title: string; detail?: string | undefined; state: State };

function runState(terminal: RunView | undefined): State {
  switch (terminal?.status) {
    case undefined:
      return { label: "Not running", tone: "quiet" };
    case "running":
      return { label: terminal.activity === "busy" ? "Busy" : "Running", tone: "live" };
    case "ready":
      return { label: "Ready", tone: "done" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "exited":
      return { label: "Exited", tone: "quiet" };
    default:
      return { label: "Closed", tone: "quiet" };
  }
}

/** Saved run configurations with their terminal's state, other open terminals, then background tasks. */
export function workspaceProcesses(configs: readonly RunConfigurationView[], terminals: readonly RunView[], backgroundTasks: number | undefined): Process[] {
  const out: Process[] = configs.map((config) => ({ id: `config:${config.id}`, title: config.name, detail: config.command, state: runState(terminals.find((terminal) => terminal.configId === config.id)) }));
  const saved = new Set(configs.map((config) => config.id));
  for (const terminal of terminals) {
    const open = terminal.status === "running" || terminal.status === "ready";
    if (open && !saved.has(terminal.configId ?? "")) out.push({ id: `terminal:${terminal.terminalId}`, title: terminal.title, detail: terminal.command, state: runState(terminal) });
  }
  if (backgroundTasks) out.push({ id: "background", title: "Background tasks", detail: backgroundTasks === 1 ? "1 task still working" : `${backgroundTasks} tasks still working`, state: { label: "Working", tone: "live" } });
  return out;
}
