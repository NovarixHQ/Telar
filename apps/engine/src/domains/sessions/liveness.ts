import type { Task, Turn } from "@telar/engine-client";

/** How long a turn Telar cut off (its worker went away) still counts as live: a planned restart continues it. */
export const CUT_OFF_GRACE_MS = 2 * 60_000;

const LIVE_TURN_STATES: ReadonlySet<Turn["state"]> = new Set(["queued", "claimed", "running", "steering"]);
const LIVE_TASK_STATES: ReadonlySet<Task["state"]> = new Set(["pending", "running", "waiting"]);

/** Everything below one session node that can still make it run, read from the stores that own each node. */
export type SessionSubtree = {
  liveTurns: Turn[];
  recentTurns: Turn[];
  tasks: Task[];
  scheduled: boolean;
  awaitsSubscription: boolean;
  heldMail: boolean;
  workingBuilders: string[];
  now: number;
};

export function cutOffByTelar(turn: Turn): boolean {
  if (turn.state === "stopped") return turn.stopReason === "worker_unavailable";
  return turn.state === "failed" && turn.failure?.code === "interrupted";
}

/** A task's chain up to its turn: `task_c < task_b < run_x`. */
function taskPath(task: Task, byId: Map<string, Task>): string {
  const chain = [task.id];
  for (let parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined; parent && chain.length < 16; parent = parent.parentTaskId ? byId.get(parent.parentTaskId) : undefined) {
    chain.push(parent.id);
  }
  return `task:${chain.join("<")}<${task.runId}`;
}

/** Why the session is live, one reason per live node below it; empty means nothing will run it again. */
export function livenessOf(subtree: SessionSubtree): string[] {
  const reasons: string[] = [];
  for (const turn of subtree.liveTurns) {
    if (turn.agentDelivery !== "passive" && LIVE_TURN_STATES.has(turn.state)) reasons.push(`turn:${turn.runId}`);
  }
  for (const turn of subtree.recentTurns) {
    if (cutOffByTelar(turn) && subtree.now - (turn.completedAt ?? 0) < CUT_OFF_GRACE_MS) reasons.push(`resumable:${turn.runId}`);
  }
  const byId = new Map(subtree.tasks.map((task) => [task.id, task]));
  for (const task of subtree.tasks) {
    if (LIVE_TASK_STATES.has(task.state)) reasons.push(taskPath(task, byId));
  }
  for (const builder of subtree.workingBuilders) reasons.push(`builder:${builder}`);
  if (subtree.scheduled) reasons.push("schedule");
  if (subtree.awaitsSubscription) reasons.push("subscription");
  if (subtree.heldMail) reasons.push("mail");
  return reasons;
}
