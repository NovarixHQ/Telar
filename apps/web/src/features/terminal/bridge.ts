import { domainMethods, shellStreamPath, type ShellActivity, type ShellEnding, type ShellFacts, type ShellFrame, type ShellOpened, type ShellOpenInput } from "@telar/engine-client";
import { readEventStream } from "@/platform/engine/event-stream";
import { pathnameFetcher, type Fetcher } from "@/platform/engine/host-client";
import { apiTransport } from "@/platform/engine/transport";

export type TerminalEnding = ShellEnding;
export type LiveTerminal = ShellFacts;
export type TerminalOpenRequest = ShellOpenInput;
export type TerminalActivity = ShellActivity;

/** `cursor` is only on a run's frames. */
export type TerminalChunk = { id: string; data: string; cursor?: number };

export type KittyFileAnswer = { ok: true; bytes: Uint8Array } | { ok: false; code: string };

export type TerminalBridge = {
  open: (options: TerminalOpenRequest) => Promise<ShellOpened>;
  write: (id: string, data: string) => Promise<{ ok: boolean }>;
  resize: (id: string, cols: number, rows: number) => Promise<{ ok: boolean }>;
  kill: (id: string, signal?: string) => Promise<{ ok: boolean }>;
  close?: (id: string) => Promise<{ ok: boolean }>;
  active?: (ids?: string[]) => Promise<{ terminals: TerminalActivity[] }>;
  list: () => Promise<{ terminals: LiveTerminal[] }>;
  readImageFile?: (path: string) => Promise<KittyFileAnswer>;
  /** Starts delivering one terminal's output and ending to `onData` and `onExit`; returns the stop. */
  follow?: (id: string) => () => void;
  onData: (listener: (chunk: TerminalChunk) => void) => (() => void) | undefined;
  onExit: (listener: (ending: TerminalEnding) => void) => (() => void) | undefined;
};

const RETRY_MS = [500, 1_000, 2_000, 5_000];

const SIGNALS = new Set(["SIGTERM", "SIGINT", "SIGKILL", "SIGHUP"]);

function toBytes(base64: string): Uint8Array {
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** A terminal's keystrokes and resizes go one request at a time and in order; input typed meanwhile rides the next one. */
function inOrder(send: (id: string, data: string) => Promise<unknown>) {
  const pending = new Map<string, string>();
  const flying = new Set<string>();
  return async (id: string, data: string): Promise<void> => {
    pending.set(id, (pending.get(id) ?? "") + data);
    if (flying.has(id)) return;
    flying.add(id);
    try {
      while (pending.has(id)) {
        const next = pending.get(id)!;
        pending.delete(id);
        await send(id, next);
      }
    } finally {
      flying.delete(id);
    }
  };
}

/** The host's terminals over the engine's `/v2/terminals`; on a paired Mac's session the shell runs on that Mac. */
export function createTerminalBridge(fetcher: Fetcher, retryMs: readonly number[] = RETRY_MS): TerminalBridge {
  const engine = domainMethods(apiTransport(fetcher, null));
  const dataListeners = new Set<(chunk: TerminalChunk) => void>();
  const exitListeners = new Set<(ending: TerminalEnding) => void>();
  const typed = inOrder((id, data) => engine.writeShell(id, data));
  const subscribe = <T>(listeners: Set<(value: T) => void>, listener: (value: T) => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };

  const end = (id: string, ending: TerminalEnding | undefined) => {
    for (const listener of exitListeners) listener(ending ?? { id, fate: "exited" });
  };

  async function follow(id: string, signal: AbortSignal): Promise<void> {
    let cursor = 0;
    for (let attempt = 0; !signal.aborted; attempt += 1) {
      try {
        const response = await fetcher(shellStreamPath(id).replace(/^\/v2\//, "/api/"), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ after: cursor }),
          signal,
        });
        if (response.status === 404) return end(id, undefined);
        if (response.ok && response.body) {
          attempt = 0;
          let exited = false;
          await readEventStream(response.body, signal, (data) => {
            const frame = data as ShellFrame;
            if (frame.type === "data") {
              cursor = frame.cursor;
              for (const listener of dataListeners) listener({ id, data: frame.data, cursor: frame.cursor });
            } else if (frame.type === "exit") {
              exited = true;
              end(id, frame.ending);
            }
          });
          if (exited) return;
        }
      } catch {
        if (signal.aborted) return;
      }
      await wait(retryMs[Math.min(attempt, retryMs.length - 1)]!, signal);
    }
  }

  return {
    open: (options) => engine.openShell(options),
    write: async (id, data) => {
      await typed(id, data);
      return { ok: true };
    },
    resize: (id, cols, rows) => engine.resizeShell(id, cols, rows),
    kill: (id, signal) => engine.killShell(id, signal && SIGNALS.has(signal) ? (signal as "SIGTERM") : undefined),
    close: (id) => engine.closeShell(id),
    active: (ids) => engine.shellActivity(ids),
    list: () => engine.listShells(),
    readImageFile: async (path) => {
      const answer = await engine.readShellImage(path);
      return answer.ok ? { ok: true, bytes: toBytes(answer.base64) } : answer;
    },
    follow: (id) => {
      const controller = new AbortController();
      void follow(id, controller.signal);
      return () => controller.abort();
    },
    onData: (listener) => subscribe(dataListeners, listener),
    onExit: (listener) => subscribe(exitListeners, listener),
  };
}

let local: TerminalBridge | undefined;
let installed: TerminalBridge | undefined;

/** Replaces the engine-backed bridge; for tests. */
export function installTerminalBridge(bridge: TerminalBridge | undefined): void {
  installed = bridge;
}

/** The terminals of the cockpit's current host; undefined while rendering on the server. */
export function terminalBridge(): TerminalBridge | undefined {
  if (installed) return installed;
  if (typeof window === "undefined") return undefined;
  local ??= createTerminalBridge(pathnameFetcher);
  return local;
}

export function isUnenterableCwd(ending: TerminalEnding): boolean {
  if (ending.fate !== "failed" || !ending.error) return false;
  return ending.error.startsWith("Telar cannot start a terminal in") || ending.error.startsWith("Telar was asked to start a terminal in");
}

export function describeTerminalEnding(ending: TerminalEnding): string {
  if (ending.fate === "failed") return `This shell never started${ending.error ? `: ${ending.error}` : "."}`;
  if (ending.closed) return "Shell closed.";
  if (ending.signal) return `Shell ended on ${ending.signal}.`;
  if (ending.exitCode === undefined) return "Shell ended.";
  return ending.exitCode === 0 ? "Shell exited." : `Shell exited with status ${ending.exitCode}.`;
}
