/**
 * CLOSING A TERMINAL ENDS WHAT RUNS IN IT — and whether to ASK first.
 *
 * "Run = a new terminal" made the terminal the owner of its process: closing a
 * Terminal tab, or an entry in the masthead's Run menu, ends the process group
 * inside it. There is no "close the tab, the run keeps going", so a close is a real kill, and a kill of somebody's dev server or a
 * half-finished `git rebase` deserves a question.
 *
 * ONLY WHEN SOMETHING IS ACTUALLY RUNNING. An idle shell at its prompt loses
 * nothing when it closes, and asking about it anyway is how people learn to
 * press Enter on every dialog without reading it. The host answers "is
 * anything running in these terminals" with one process-table read, taken
 * only when asked (`terminal.active`), and this file turns that answer into
 * either "close" or one sentence to confirm.
 *
 * THE DECISION IS PURE AND SEPARATE FROM THE ASKING, so the rule — which
 * terminals count, what the sentence says, what an unanswerable question
 * means — is tested as a function, without a host or a dialog.
 */
import { terminalBridge, type TerminalActivity, type TerminalBridge } from "./bridge";
import { readTerminalTab } from "./tab";

/** One terminal a close would end. */
export type CloseTarget = {
  /** The host's terminal id — a run's `terminalId`, or a shell's PTY id. */
  id: string;
  /** What the tab calls it: "web dev #2", "this shell". */
  label: string;
  /**
   * WHAT THE PERSON LAUNCHED, when we know it better than the process table
   * does. A run's configured `bun run dev` reads better than the
   * `node …/next dev` it became; a shell has no such thing, and the host's own
   * reading of the foreground command is used instead.
   */
  command?: string;
};

export type CloseDecision = { action: "close" } | { action: "confirm"; message: string };

/** Mirrors the host's own `clip` (apps/desktop/terminal-host.js): one line,
 *  and short enough that a dialog does not wrap a command into a paragraph. */
function clip(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function processCount(processes: number): string {
  return processes === 1 ? "1 process" : `${processes} processes`;
}

/** "bun run dev (4 processes)" — the count only when the host could count. */
function describeBusy(target: CloseTarget, activity: TerminalActivity | undefined): string {
  const command = target.command?.trim() || activity?.command?.trim();
  const what = command ? `“${clip(command)}”` : `what is running in ${target.label}`;
  return activity && activity.processes > 0 ? `${what} (${processCount(activity.processes)})` : what;
}

/**
 * CLOSE, OR CONFIRM WITH ONE SENTENCE.
 *
 * `activity` is the host's answer, or `undefined` when there was nobody to ask
 * (a session on another Mac, whose terminals this window cannot inspect) or the
 * question failed. AN UNANSWERED QUESTION COUNTS AS BUSY — the host's own rule
 * for an unreadable process table, for the same reason: a needless question
 * costs a click, a missing one costs somebody's server.
 *
 * A TERMINAL THE HOST DOES NOT MENTION HAS ALREADY ENDED. The host answers for
 * the terminals it still holds, and one it has let go has nothing left to lose.
 *
 */
export function decideClose(targets: readonly CloseTarget[], activity: readonly TerminalActivity[] | undefined): CloseDecision {
  const busy = targets
    .map((target) => ({ target, activity: activity?.find((entry) => entry.id === target.id) }))
    .filter((entry) => (activity === undefined ? true : entry.activity?.active === true));
  if (busy.length === 0) return { action: "close" };

  if (busy.length === 1) {
    const { target, activity: one } = busy[0]!;
    return {
      action: "confirm",
      message: `End ${describeBusy(target, one)}?\n\nClosing ${target.label} stops it, and anything it has not saved or finished is lost.`,
    };
  }

  const lines = busy.slice(0, 5).map(({ target, activity: one }) => `• ${describeBusy(target, one)}`);
  if (busy.length > lines.length) lines.push(`…and ${busy.length - lines.length} more`);
  return {
    action: "confirm",
    message: `End ${busy.length} commands still running?\n\n${lines.join("\n")}\n\nClosing stops them, and anything they have not saved or finished is lost.`,
  };
}

/**
 * ASK THE HOST, THEN THE PERSON — true when the close may go ahead.
 *
 * `bridge` and `confirm` are injected so this runs in a test without a shell
 * or a dialog; the defaults are the real ones.
 *
 * TWO WAYS OF HAVING NOBODY TO ASK, AND THEY ARE ANSWERED DIFFERENTLY:
 *   - NO BRIDGE AT ALL is a session on another Mac, whose run terminals this
 *     window cannot inspect. The question is unanswered, which `decideClose`
 *     reads as busy — an open run is, by definition, its command running.
 *   - A BRIDGE WITHOUT `active` is a desktop build older than the question.
 *     It closed without asking, and so does this: a prompt on every shell
 *     close is what teaches people to stop reading prompts.
 */
export async function mayClose(
  targets: readonly CloseTarget[],
  options: {
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
  const decision = decideClose(targets, activity);
  if (decision.action === "close") return true;
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  return confirm(decision.message);
}

/**
 * END ONE TERMINAL, whichever kind it is.
 *
 * A RUN IS ENDED THROUGH THE ENGINE, a shell through the host. The engine
 * started the run, keeps its record and tells the agent who closed it, so a
 * run closed behind its back would read as "ended by itself". A person's shell
 * is the renderer's own and the host's `close` is the whole of it: SIGTERM to
 * every process group, SIGKILL a second later to whatever stayed.
 *
 * A FAILED END IS NOT AN ERROR here. The process may have exited while the
 * person was reading the question, which is the ordinary race, and the status
 * feed or the exit event is what reports the truth afterwards.
 */
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
    // `close` is the host's close-means-kill; `kill` is its predecessor, kept
    // for a shell whose preload predates it.
    await (bridge.close ? bridge.close(target.terminalId) : bridge.kill(target.terminalId, "SIGTERM"));
  } catch {
    // See above: the race with an exit is the normal case.
  }
}

/**
 * Closing a Terminal tab ends its shell or run, asking first if something runs in it; false when the person said no.
 * The cockpit calls this, since only it can tell a tab closing from a tab switch that unmounts the surface.
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
  const targets = tab.terminalId ? [{ id: tab.terminalId, label: tab.title ?? (tab.run ? "this run" : "this shell") }] : [];
  if (!(await mayClose(targets, { bridge, ...(options.confirm ? { confirm: options.confirm } : {}) }))) return false;
  const terminalId = tab.run?.runId ?? tab.terminalId;
  if (terminalId) await endTerminal({ terminalId, run: Boolean(tab.run) }, { bridge, ...(options.stopRun ? { stopRun: options.stopRun } : {}) });
  return true;
}
