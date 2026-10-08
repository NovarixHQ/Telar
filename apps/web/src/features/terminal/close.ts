import { terminalBridge, type TerminalActivity, type TerminalBridge } from "./bridge";
import { isOpenTerminal } from "./run/presentation";
import type { RunView } from "./run/types";
import { readTerminalTab } from "./tab";
import { isWorkspaceParams, readWorkspace, shellLabel, type TerminalWorkspace } from "./workspace";

/** One terminal a close would end. */
export type CloseTarget = {
  /** The host's terminal id: a run's `terminalId`, or a shell's PTY id. */
  id: string;
  /** What the tab calls it: "web dev #2", "this shell". */
  label: string;
  /** What the person launched, when known better than the process table does. */
  command?: string;
};

export type CloseDecision = { action: "close" } | { action: "confirm"; message: string };

/** Mirrors the host's own `clip` (apps/desktop/terminal-host.js). */
function clip(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function processCount(processes: number): string {
  return processes === 1 ? "1 process" : `${processes} processes`;
}

function describeBusy(target: CloseTarget, activity: TerminalActivity | undefined): string {
  const command = target.command?.trim() || activity?.command?.trim();
  const what = command ? `“${clip(command)}”` : `what is running in ${target.label}`;
  return activity && activity.processes > 0 ? `${what} (${processCount(activity.processes)})` : what;
}

/**
 * Close, or confirm with one sentence. `activity` undefined means nobody could be asked, which counts as busy;
 * a terminal the host does not mention has already ended. `scope` is what was pressed: one terminal, or a whole strip.
 */
export function decideClose(targets: readonly CloseTarget[], activity: readonly TerminalActivity[] | undefined, scope: "terminal" | "tab" = "terminal"): CloseDecision {
  const busy = targets
    .map((target) => ({ target, activity: activity?.find((entry) => entry.id === target.id) }))
    .filter((entry) => (activity === undefined ? true : entry.activity?.active === true));
  if (busy.length === 0) return { action: "close" };

  if (busy.length === 1 && scope === "terminal") {
    const { target, activity: one } = busy[0]!;
    return {
      action: "confirm",
      message: `End ${describeBusy(target, one)}?\n\nClosing ${target.label} stops it, and anything it has not saved or finished is lost.`,
    };
  }

  const lines = busy.slice(0, 5).map(({ target, activity: one }) => `• ${describeBusy(target, one)}`);
  if (busy.length > lines.length) lines.push(`…and ${busy.length - lines.length} more`);
  if (scope === "tab") {
    const head = busy.length === 1 ? "End the command still running in this Terminal?" : `End ${busy.length} commands still running in this Terminal?`;
    return { action: "confirm", message: `${head}\n\n${lines.join("\n")}\n\nClosing the Terminal closes every terminal in it and stops what runs there.` };
  }
  return {
    action: "confirm",
    message: `End ${busy.length} commands still running?\n\n${lines.join("\n")}\n\nClosing stops them, and anything they have not saved or finished is lost.`,
  };
}

/**
 * Asks the host, then the person; true when the close may go ahead. No bridge is a session on another Mac, which
 * reads as busy; a bridge without `active` is an older desktop build, which closes without asking as it always did.
 */
export async function mayClose(
  targets: readonly CloseTarget[],
  options: {
    scope?: "terminal" | "tab";
    bridge?: TerminalBridge | undefined;
    confirm?: (message: string) => boolean;
  } = {},
): Promise<boolean> {
  if (targets.length === 0) return true;
  const bridge = "bridge" in options ? options.bridge : terminalBridge();
  if (bridge && !bridge.active) return true;
  let activity: TerminalActivity[] | undefined;
  try {
    activity = bridge?.active ? (await bridge.active(targets.map((target) => target.id))).terminals : undefined;
  } catch {
    activity = undefined;
  }
  const decision = decideClose(targets, activity, options.scope ?? "terminal");
  if (decision.action === "close") return true;
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  return confirm(decision.message);
}

/** A run is ended through the engine, which records who closed it; a shell through the host. A failed end is the race with an exit. */
export async function endTerminal(
  target: { terminalId: string; run?: boolean },
  options: { bridge?: TerminalBridge | undefined; stopRun?: (terminalId: string) => Promise<unknown> } = {},
): Promise<void> {
  try {
    if (target.run) {
      await options.stopRun?.(target.terminalId);
      return;
    }
    const bridge = "bridge" in options ? options.bridge : terminalBridge();
    if (!bridge) return;
    await (bridge.close ? bridge.close(target.terminalId) : bridge.kill(target.terminalId, "SIGTERM"));
  } catch {
    return;
  }
}

/**
 * Closing a Terminal tab ends its shell or run, or every one in a grouped tab's strip, asking once if something runs;
 * false when the person said no. The cockpit calls this, since only it can tell a tab closing from a tab switch.
 */
export async function closeTerminalTab(
  params: Readonly<Record<string, string>>,
  options: {
    bridge?: TerminalBridge | undefined;
    stopRun?: (terminalId: string) => Promise<unknown>;
    confirm?: (message: string) => boolean;
  } = {},
): Promise<boolean> {
  const workspace = isWorkspaceParams(params) ? readWorkspace(params) : undefined;
  const shells = workspace ? workspace.shells : [{ ...readTerminalTab(params), id: "" }];
  const held = shells.filter((shell): shell is typeof shell & { terminalId: string } => Boolean(shell.terminalId));
  const label = (shell: (typeof shells)[number]) => (workspace ? shellLabel(workspace, shell.id) : (shell.title ?? (shell.run ? "this run" : "this shell")));
  const targets = held.map((shell) => ({ id: shell.terminalId, label: label(shell) }));
  const bridge = "bridge" in options ? options.bridge : terminalBridge();
  if (!(await mayClose(targets, { scope: workspace ? "tab" : "terminal", bridge, ...(options.confirm ? { confirm: options.confirm } : {}) }))) return false;
  const ending = workspace ? held : shells.filter((shell) => shell.run || shell.terminalId);
  await Promise.all(
    ending.map((shell) =>
      endTerminal({ terminalId: shell.run?.runId ?? shell.terminalId!, run: Boolean(shell.run) }, { bridge, ...(options.stopRun ? { stopRun: options.stopRun } : {}) }),
    ),
  );
  return true;
}

/** Chips whose run ended or sits idle, and shells the host says run nothing; unread activity counts as busy. */
export function idleChips(workspace: TerminalWorkspace, runs: ReadonlyMap<string, RunView> | undefined, activity: readonly TerminalActivity[] | undefined): string[] {
  return workspace.shells
    .filter((shell) => {
      if (shell.run) {
        if (!runs) return false;
        const view = runs.get(shell.run.runId);
        return !isOpenTerminal(view) || view!.activity === "idle";
      }
      if (!shell.terminalId || !activity) return false;
      return activity.find((entry) => entry.id === shell.terminalId)?.active !== true;
    })
    .map((shell) => shell.id);
}
