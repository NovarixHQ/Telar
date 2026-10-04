import type { LiveRun } from "./live-run";
import { isTerminal } from "./types";

export const AGENT_SHELL_CAP = 4;
export const AGENT_SHELL_IDLE_MS = 30 * 60_000;

/** A shell an agent opened with a command of its own; a person's run or shell is never one. */
const agentShell = (run: LiveRun) => run.origin === "agent" && !run.config.id && !isTerminal(run.status);

const idle = (run: LiveRun) => run.activity === "idle" && run.handle?.write !== undefined && !run.closeTask;

const idleSince = (run: LiveRun) => run.lastExit?.at ?? run.startedAt;

export function idleAgentShell(runs: Iterable<LiveRun>, sessionId: string, cwd: string): LiveRun | undefined {
  return [...runs]
    .filter((run) => run.sessionId === sessionId && run.cwd === cwd && agentShell(run) && idle(run))
    .sort((a, b) => idleSince(b) - idleSince(a))[0];
}

/** The agent shell to close before opening one more, once the session holds `cap`: the longest idle, never a busy one. */
export function evictionFor(runs: Iterable<LiveRun>, sessionId: string, cap: number): LiveRun | undefined {
  const open = [...runs].filter((run) => run.sessionId === sessionId && agentShell(run));
  if (open.length < cap) return undefined;
  return open.filter(idle).sort((a, b) => idleSince(a) - idleSince(b))[0];
}

export function expiredAgentShells(runs: Iterable<LiveRun>, now: number, idleMs: number): LiveRun[] {
  return [...runs].filter((run) => agentShell(run) && idle(run) && now - idleSince(run) >= idleMs);
}
