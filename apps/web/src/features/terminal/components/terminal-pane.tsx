"use client";

import "@xterm/xterm/css/xterm.css";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";
import { describeTerminalEnding } from "../bridge";
import { useShellEmulator } from "../hooks/use-shell-emulator";

export function TerminalPane(props: {
  sessionId?: string;
  projectId?: string;
  terminalId?: string;
  onTerminalId: (id: string) => void;
  /** What the shell called itself through OSC 0/2. */
  onTitle: (title: string) => void;
  /** On screen: fits and takes the keyboard. A hidden pane stays mounted. */
  visible: boolean;
}) {
  const { host, phase, retryInHome } = useShellEmulator(props);
  return (
    <div
      data-testid="terminal-pane"
      className="absolute inset-0 flex flex-col"
    >
      {phase.kind === "ended" && (
        <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground" role="status">
          {describeTerminalEnding(phase.ending)}
        </p>
      )}
      {phase.kind === "unavailable" && <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">{phase.why}</p>}
      {phase.kind === "cwd-refused" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-xs text-muted-foreground">{describeTerminalEnding(phase.ending)}</p>
          <Button size="sm" variant="outline" onClick={() => retryInHome.current?.()}>
            Open a shell in your home folder instead
          </Button>
        </div>
      )}
      {/* bg-card always: xterm paints its background only after the first cell. Hidden, not unmounted, so `host` stays stable. */}
      <div
        ref={host}
        data-testid="terminal-host"
        className={cn("min-h-0 flex-1 overflow-hidden bg-card px-1 py-1", phase.kind === "cwd-refused" && "hidden")}
      />
    </div>
  );
}
