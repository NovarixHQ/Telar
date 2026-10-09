import { terminalBridge, type TerminalActivity, type TerminalBridge } from "./bridge";
import { readTerminalTab } from "./tab";

/** One terminal a close would end. */
export type CloseTarget = {
  /** The host's terminal id: a run's `terminalId`, or a shell's PTY id. */
  id: string;
  /** What the tab calls it: "web dev #2", "this shell". */
  label: string;
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
  const command = activity?.command?.trim();
  const what = command ? `“${clip(command)}”` : `what is running in ${target.label}`;
  return activity && activity.processes > 0 ? `${what} (${processCount(activity.processes)})` : what;
}

/**
 * Close, or confirm with one sentence. `activity` undefined means nobody could be asked, which counts as busy;
 * a terminal the host does not mention has already ended.
 */
export function decideClose(target: CloseTarget, activity: readonly TerminalActivity[] | undefined): CloseDecision {
  const one = activity?.find((entry) => entry.id === target.id);
  if (activity !== undefined && one?.active !== true) return { action: "close" };
  return {
    action: "confirm",
    message: `End ${describeBusy(target, one)}?\n\nClosing ${target.label} stops it, and anything it has not saved or finished is lost.`,
  };
}

/**
 * Asks the host, then the person; true when the close may go ahead. No bridge is a session on another Mac, which
 * reads as busy; a bridge without `active` is an older desktop build, which closes without asking as it always did.
 */
export async function mayClose(target: CloseTarget, options: { bridge?: TerminalBridge | undefined; confirm?: (message: string) => boolean } = {}): Promise<boolean> {
  const bridge = "bridge" in options ? options.bridge : terminalBridge();
  if (bridge && !bridge.active) return true;
  let activity: TerminalActivity[] | undefined;
  try {
    activity = bridge?.active ? (await bridge.active([target.id])).terminals : undefined;
  } catch {
    activity = undefined;
  }
  const decision = decideClose(target, activity);
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
 * Closing a Terminal tab ends its shell or run, asking first if something runs; false when the person said no.
 * The cockpit calls this, since only it can tell a tab closing from a tab switch.
 */
export async function closeTerminalTab(
  params: Readonly<Record<string, string>>,
  options: {
    bridge?: TerminalBridge | undefined;
    stopRun?: (terminalId: string) => Promise<unknown>;
    confirm?: (message: string) => boolean;
  } = {},
): Promise<boolean> {
  const tab = readTerminalTab(params);
  const bridge = "bridge" in options ? options.bridge : terminalBridge();
  if (tab.terminalId) {
    const target = { id: tab.terminalId, label: tab.title ?? (tab.run ? "this run" : "this shell") };
    if (!(await mayClose(target, { bridge, ...(options.confirm ? { confirm: options.confirm } : {}) }))) return false;
  }
  const terminalId = tab.run?.runId ?? tab.terminalId;
  if (terminalId) await endTerminal({ terminalId, run: Boolean(tab.run) }, { bridge, ...(options.stopRun ? { stopRun: options.stopRun } : {}) });
  return true;
}
