"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { claimChords } from "@/features/commands";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { cn } from "@/ui/utils";
import { TERMINAL_CHORD_CLAIMS } from "../keys";
import { createRunApi } from "../run/api";
import { isOpenTerminal, statusDetail, statusLabel, statusTone } from "../run/presentation";
import { useRunStatusFeed } from "../run/status-stream";
import { readTerminalTab, terminalTabParams, withTerminalId, withTitle, type TerminalTab } from "../tab";
import { RunPane } from "./run-pane";
import { TerminalPane } from "./terminal-pane";
import { TONE_DOT } from "./terminal-strip";

// macOS matches ⌘T against the app menu first, so it needs a claim, and only while focus is inside.
const FOCUSED_CHORD_CLAIMS: readonly string[] = ["CommandOrControl+T"];

type SurfaceProps = {
  sessionId?: string;
  projectId?: string;
  /** Which Mac the session lives on; absent means this cockpit's own. */
  hostId?: string;
  params?: Readonly<Record<string, string>>;
  /** Replaces the tab's params. */
  onParams?: (params: Record<string, string>) => void;
  onCloseSelf?: () => void;
  /** Opens another Terminal tab (⌘T). */
  onOpenNew?: () => void;
  visible?: boolean;
};

/** One Terminal tab: one shell, or one run. The tab's params are its whole persistence, so a remount re-adopts the PTY. */
export function TerminalSurface(props: SurfaceProps) {
  const { sessionId, params = {}, onCloseSelf, onOpenNew } = props;
  const tab = readTerminalTab(params);
  useEffect(() => claimChords(TERMINAL_CHORD_CLAIMS), []);
  const [hasKeys, setHasKeys] = useState(false);
  useEffect(() => (hasKeys ? claimChords(FOCUSED_CHORD_CLAIMS) : undefined), [hasKeys]);

  // Capture phase and the native stopImmediatePropagation: xterm's textarea and the window dispatcher would answer too.
  const onKeys = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    const letter = event.key.toLowerCase();
    const action = letter === "t" ? onOpenNew : letter === "w" ? onCloseSelf : undefined;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    action();
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={onKeys}
      // focusin/focusout: the `contains` check keeps a move between two children from reading as a release.
      onFocus={() => setHasKeys(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHasKeys(false);
      }}
    >
      {tab.run && sessionId ? <RunTerminal {...props} sessionId={sessionId} tab={tab} run={tab.run} /> : <ShellTerminal {...props} params={params} />}
    </div>
  );
}

function ShellTerminal({ sessionId, projectId, params, onParams, visible = true }: SurfaceProps & { params: Readonly<Record<string, string>> }) {
  // What was last written, so a title and a PTY id arriving before the parent re-renders do not overwrite each other.
  const latest = useRef(params);
  const received = useRef(params);
  useEffect(() => {
    if (received.current === params) return;
    received.current = params;
    latest.current = params;
  }, [params]);
  const update = (next: (tab: TerminalTab) => TerminalTab) => {
    const written = terminalTabParams(next(readTerminalTab(latest.current)));
    latest.current = written;
    onParams?.(written);
  };
  const terminalId = readTerminalTab(params).terminalId;
  return (
    <div className="relative min-h-0 flex-1">
      <TerminalPane
        {...(sessionId ? { sessionId } : {})}
        {...(projectId ? { projectId } : {})}
        {...(terminalId ? { terminalId } : {})}
        onTerminalId={(id) => update((tab) => withTerminalId(tab, id))}
        onTitle={(title) => update((tab) => withTitle(tab, title))}
        active
        visible={visible}
      />
    </div>
  );
}

function RunTerminal({ sessionId, hostId, tab, run, visible = true }: SurfaceProps & { sessionId: string; tab: TerminalTab; run: { runId: string } }) {
  const api = useMemo(() => createRunApi(hostFetcher(hostId ?? LOCAL_HOST_ID)), [hostId]);
  const feed = useRunStatusFeed({ sessionId, ...(hostId ? { hostId } : {}), api });
  const view = feed.status?.terminals?.find((entry) => entry.runId === run.runId);
  const label = tab.title ?? "Run";
  const restart = () => {
    void api
      .restart(sessionId, run.runId)
      .catch(() => undefined)
      .finally(() => feed.refresh());
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1 text-xs">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[view ? statusTone(view) : "idle"])} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={view?.command}>
          {view ? `${statusLabel(view)}${view.command ? ` · ${view.command}` : ""}` : label}
        </span>
        {view?.warning && isOpenTerminal(view) && (
          <span role="img" aria-label={statusDetail(view)} title={statusDetail(view)} className="shrink-0 text-warning">
            <TriangleAlertIcon className="size-3" />
          </span>
        )}
        {view && (
          <button
            type="button"
            aria-label={`Run ${label} again`}
            title="Run again — runs the last command again in this shell"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={restart}
          >
            <RotateCwIcon className="size-3" />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Keyed by the run: reusing an emulator across runs would show one process's bytes under another's. */}
        <RunPane
          key={run.runId}
          api={api}
          sessionId={sessionId}
          runId={run.runId}
          {...(tab.terminalId ? { terminalId: tab.terminalId } : {})}
          live={isOpenTerminal(view)}
          active
          visible={visible}
        />
      </div>
    </>
  );
}
