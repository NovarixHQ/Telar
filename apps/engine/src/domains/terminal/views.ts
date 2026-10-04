import type { RunView } from "@telar/engine-client";
import type { RunRecord } from "./journal";
import type { LiveRun } from "./live-run";
import { isTerminal, redactText } from "./types";

export function titleOf(run: Pick<LiveRun, "instance" | "baseTitle">): string {
  return run.instance > 1 ? `${run.baseTitle} #${run.instance}` : run.baseTitle;
}

export function splitTitle(title: string): { base: string; instance: number } {
  const match = /^(.*) #(\d+)$/.exec(title);
  if (match && Number(match[2]) > 1) return { base: match[1]!, instance: Number(match[2]) };
  return { base: title, instance: 1 };
}

export function recordOf(run: LiveRun): RunRecord {
  const hide = (text: string) => redactText(text, run.secrets);
  return {
    terminalId: run.terminalId,
    projectId: run.projectId,
    sessionId: run.sessionId,
    origin: run.origin,
    title: hide(titleOf(run)),
    ...(run.config.id ? { configId: run.config.id } : {}),
    configName: hide(run.configName),
    command: hide(run.command),
    worktreePath: hide(run.worktreePath),
    ...(run.worktreeBranch ? { worktreeBranch: hide(run.worktreeBranch) } : {}),
    cwd: hide(run.cwd),
    ...(run.config.readinessUrl ? { readinessUrl: hide(run.config.readinessUrl) } : {}),
    startedAt: run.startedAt,
    shellKind: run.shell.kind,
    integrated: run.shell.integrated,
  };
}

export function viewOf(run: LiveRun): RunView {
  const hide = (text: string) => redactText(text, run.secrets);
  return {
    terminalId: run.terminalId,
    runId: run.terminalId,
    projectId: run.projectId,
    sessionId: run.sessionId,
    origin: run.origin,
    title: hide(titleOf(run)),
    ...(run.config.id ? { configId: run.config.id } : {}),
    configName: hide(run.configName),
    command: hide(run.command),
    worktreePath: hide(run.worktreePath),
    ...(run.worktreeBranch ? { worktreeBranch: hide(run.worktreeBranch) } : {}),
    cwd: hide(run.cwd),
    status: run.status,
    activity: isTerminal(run.status) ? "idle" : run.activity,
    ...(run.lastExit ? { lastExit: run.lastExit } : {}),
    readiness: run.readiness,
    ...(run.config.readinessUrl ? { readinessUrl: hide(run.config.readinessUrl) } : {}),
    ...(run.handle?.pid !== undefined && !isTerminal(run.status) ? { pid: run.handle.pid } : {}),
    startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
    ...(run.signal ? { signal: run.signal } : {}),
    ...(run.closedBy ? { closedBy: run.closedBy } : {}),
    ...(run.warning ? { warning: run.warning } : {}),
    ...(run.error ? { error: run.error } : {}),
    env: (run.config.env ?? []).map((entry) => (entry.secret ? { key: entry.key, secret: true } : { key: entry.key, value: hide(entry.value) })),
  };
}
