import type { RunView } from "@telar/engine-client";
import type { ThemeColor } from "../../ui/theme";

export const isOpen = (run: RunView) => run.status === "running" || run.status === "ready";

const newestFirst = (a: RunView, b: RunView) => b.startedAt - a.startedAt;

/** The host's live terminals, newest first; the engine also lists ones that already ended. */
export const liveTerminals = (list: readonly RunView[]): RunView[] => list.filter(isOpen).sort(newestFirst);

/** Applies a status update: an open terminal replaces its old entry, an ended one leaves the list. */
export function upsertTerminal(list: readonly RunView[], run: RunView): RunView[] {
  const others = list.filter((other) => other.terminalId !== run.terminalId);
  return isOpen(run) ? [...others, run].sort(newestFirst) : others;
}

/** The terminal to show: the one asked for while it is listed, else the newest. */
export function pickTerminal(list: readonly RunView[], wanted: string | undefined): RunView | undefined {
  return list.find((run) => run.terminalId === wanted) ?? list[0];
}

export function statusLabel(run: RunView): string {
  switch (run.status) {
    case "running":
    case "ready": {
      if (run.activity === "busy") return run.status === "ready" ? "Ready" : "Running";
      const code = run.lastExit?.exitCode ?? 0;
      return code === 0 ? "Idle" : `Idle · exit ${code}`;
    }
    case "failed":
      return "Failed";
    case "closed":
      return "Closed";
    case "exited":
      return (run.exitCode ?? 0) === 0 ? "Exited" : `Exited (${run.exitCode})`;
  }
}

export function statusDetail(run: RunView): string | undefined {
  if (run.error) return run.error;
  if (run.warning) return `${run.warning[0]!.toUpperCase()}${run.warning.slice(1)}.`;
  if (run.status === "exited" && run.signal) return `Stopped by ${run.signal}.`;
  return undefined;
}

export function statusTone(run: RunView | undefined): ThemeColor {
  if (!run) return "textMuted";
  if (run.status === "failed") return "red";
  if (!isOpen(run) || run.activity !== "busy") return "textMuted";
  return run.status === "ready" ? "emerald" : "sky";
}
