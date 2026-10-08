/** One Terminal panel tab: a person's shell, or a run the engine owns. Persisted flat in the tab's params. */
export type TerminalTab = {
  /** The host's PTY id; absent while a shell is still opening. */
  terminalId?: string;
  /** What the shell called itself (OSC 0/2), or a run's configuration name. */
  title?: string;
  run?: { runId: string; configId: string };
};

type Params = Readonly<Record<string, string>>;

const TERMINAL_ID_PARAM = "terminal";
const TITLE_PARAM = "title";
const RUN_PARAM = "run";
const CONFIG_PARAM = "config";
const LEGACY_SHELLS_PARAM = "shells";

export function readTerminalTab(params: Params): TerminalTab {
  const terminalId = params[TERMINAL_ID_PARAM];
  const title = params[TITLE_PARAM];
  const runId = params[RUN_PARAM];
  return {
    ...(terminalId ? { terminalId } : {}),
    ...(title ? { title } : {}),
    ...(runId ? { run: { runId, configId: params[CONFIG_PARAM] ?? "" } } : {}),
  };
}

export function terminalTabParams(tab: TerminalTab): Record<string, string> {
  return {
    ...(tab.terminalId ? { [TERMINAL_ID_PARAM]: tab.terminalId } : {}),
    ...(tab.title ? { [TITLE_PARAM]: tab.title } : {}),
    ...(tab.run ? { [RUN_PARAM]: tab.run.runId, [CONFIG_PARAM]: tab.run.configId } : {}),
  };
}

/** An empty title clears it, so the tab goes back to its default label. */
export function withTitle(tab: TerminalTab, title: string): TerminalTab {
  const wanted = title.trim();
  return { ...(tab.terminalId ? { terminalId: tab.terminalId } : {}), ...(wanted ? { title: wanted } : {}), ...(tab.run ? { run: tab.run } : {}) };
}

export function withTerminalId(tab: TerminalTab, terminalId: string): TerminalTab {
  return { ...tab, terminalId };
}

/**
 * Layouts saved while one Terminal tab held a strip of shells (`shells` JSON): one params record per shell, so
 * every running shell gets its own tab. Delete after 2027-01-31.
 */
export function splitLegacyTerminalParams(params: Params): Record<string, string>[] {
  const raw = params[LEGACY_SHELLS_PARAM];
  if (!raw) return [{ ...params }];
  try {
    const parsed = JSON.parse(raw) as { shells?: unknown };
    const shells = Array.isArray(parsed.shells) ? parsed.shells : [];
    const tabs = shells.flatMap((entry): Record<string, string>[] => {
      if (!entry || typeof entry !== "object") return [];
      const shell = entry as { terminalId?: unknown; title?: unknown; run?: { runId?: unknown; configId?: unknown } };
      const runId = typeof shell.run?.runId === "string" ? shell.run.runId : undefined;
      return [
        terminalTabParams({
          ...(typeof shell.terminalId === "string" && shell.terminalId ? { terminalId: shell.terminalId } : {}),
          ...(typeof shell.title === "string" && shell.title ? { title: shell.title } : {}),
          ...(runId ? { run: { runId, configId: typeof shell.run?.configId === "string" ? shell.run.configId : "" } } : {}),
        }),
      ];
    });
    return tabs.length > 0 ? tabs : [{}];
  } catch {
    return [{}];
  }
}
