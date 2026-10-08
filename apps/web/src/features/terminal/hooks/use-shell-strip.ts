"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type SetStateAction } from "react";
import { claimChords } from "@/features/commands";
import { terminalBridge, type TerminalActivity } from "../bridge";
import { endTerminal, idleChips, mayClose } from "../close";
import { TERMINAL_CHORD_CLAIMS } from "../keys";
import { isOpenTerminal } from "../run/presentation";
import { activateShell, addShell, closeShell, emptyWorkspace, readWorkspace, shellLabel, workspaceParams, type TerminalWorkspace } from "../workspace";
import { useRunStrip } from "./use-run-strip";

// macOS matches these against the app menu first, so they need a claim; only while focus is inside, or the rail loses ⌘1–9.
const STRIP_CHORD_CLAIMS: readonly string[] = ["CommandOrControl+T", ...Array.from({ length: 9 }, (_, index) => `CommandOrControl+${index + 1}`)];

/** The strip of shells, held in the tab's params so the cockpit can add a run's chip while it shows; plus its runs and keys. */
export function useShellStrip({
  sessionId,
  hostId,
  params,
  onParams,
  onCloseSelf,
}: {
  sessionId: string | undefined;
  hostId: string | undefined;
  params: Readonly<Record<string, string>>;
  onParams: ((params: Record<string, string>) => void) | undefined;
  onCloseSelf: (() => void) | undefined;
}) {
  const [emptied, setEmptied] = useState(false);
  const stored = readWorkspace(params);
  // An empty tab draws one shell before anything is written; its PTY id is the first write.
  const workspace = stored.shells.length > 0 || emptied ? stored : addShell(emptyWorkspace());
  const latest = useRef(workspace);
  const received = useRef(params);
  const dismiss = useRef(onCloseSelf);
  useEffect(() => {
    dismiss.current = onCloseSelf;
    if (received.current === params) return;
    received.current = params;
    latest.current = workspace;
  });

  const setWorkspace = (update: SetStateAction<TerminalWorkspace>) => {
    const next = typeof update === "function" ? update(latest.current) : update;
    if (next === latest.current) return;
    latest.current = next;
    if (next.shells.length === 0) setEmptied(true);
    onParams?.(workspaceParams(next));
  };

  // After the empty strip is written, so the cockpit's close reads params with nothing left to end.
  useEffect(() => {
    if (emptied && stored.shells.length === 0) dismiss.current?.();
  }, [emptied, stored.shells.length]);

  const run = useRunStrip(sessionId, hostId);
  useEffect(() => claimChords(TERMINAL_CHORD_CLAIMS), []);
  const [hasKeys, setHasKeys] = useState(false);
  useEffect(() => (hasKeys ? claimChords(STRIP_CHORD_CLAIMS) : undefined), [hasKeys]);

  const stopRun = (runId: string) => run.runApi.stop(sessionId!, runId);
  const closing = useRef(new Set<string>());
  const closeOne = async (id: string) => {
    const shell = latest.current.shells.find((entry) => entry.id === id);
    if (!shell || closing.current.has(id)) return;
    closing.current.add(id);
    try {
      const view = shell.run ? run.runsById.get(shell.run.runId) : undefined;
      const terminalId = shell.run ? (isOpenTerminal(view) ? shell.run.runId : undefined) : shell.terminalId;
      if (terminalId) {
        const target = { id: view?.terminalId ?? terminalId, label: shellLabel(latest.current, id), ...(view?.command ? { command: view.command } : {}) };
        if (!(await mayClose([target]))) return;
        await endTerminal({ terminalId, run: Boolean(shell.run) }, { stopRun });
        if (shell.run) run.runs.refresh();
      }
      setWorkspace((current) => closeShell(current, id));
    } finally {
      closing.current.delete(id);
    }
  };

  const closeIdle = async () => {
    const shells = latest.current.shells.filter((shell) => !shell.run && shell.terminalId);
    const bridge = terminalBridge();
    let activity: TerminalActivity[] | undefined;
    try {
      activity = bridge?.active && shells.length ? (await bridge.active(shells.map((shell) => shell.terminalId!))).terminals : undefined;
    } catch {
      activity = undefined;
    }
    const ids = idleChips(latest.current, run.runs.status ? run.runsById : undefined, activity);
    const chips = latest.current.shells.filter((shell) => ids.includes(shell.id));
    await Promise.all(
      chips.map((shell) => {
        const terminalId = shell.run ? (isOpenTerminal(run.runsById.get(shell.run.runId)) ? shell.run.runId : undefined) : shell.terminalId;
        return terminalId ? endTerminal({ terminalId, run: Boolean(shell.run) }, { bridge, stopRun }) : undefined;
      }),
    );
    if (chips.some((shell) => shell.run)) run.runs.refresh();
    setWorkspace((current) => ids.reduce(closeShell, current));
  };

  // Capture phase and the native stopImmediatePropagation: xterm's textarea and the window dispatcher would answer too.
  const onKeys = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const shells = workspace.shells;
    const take = () => {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    };
    // By `code`: with Shift held, `key` for these differs by layout.
    if (event.shiftKey && (event.code === "BracketLeft" || event.code === "BracketRight")) {
      if (shells.length < 2) return;
      take();
      const at = shells.findIndex((shell) => shell.id === workspace.active);
      const step = event.code === "BracketRight" ? 1 : shells.length - 1;
      setWorkspace((current) => activateShell(current, shells[(Math.max(at, 0) + step) % shells.length]!.id));
      return;
    }
    const letter = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (letter === "t") {
      take();
      setWorkspace((current) => addShell(current));
    } else if (letter === "w") {
      take();
      if (workspace.active) void closeOne(workspace.active);
    } else if (/^[1-9]$/.test(letter)) {
      const target = shells[Number(letter) - 1];
      if (!target) return;
      take();
      setWorkspace((current) => activateShell(current, target.id));
    }
  };

  return { workspace, setWorkspace, run, closeOne, closeIdle, onKeys, setHasKeys };
}

export type ShellStrip = ReturnType<typeof useShellStrip>;
