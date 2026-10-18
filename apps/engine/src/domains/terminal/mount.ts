import { type RunStatusEvent, type RunStreamFrame, type RunView } from "@telar/engine-client";
import fs from "node:fs";
import path from "node:path";
import { terminalLauncher } from "./launcher";
import { RunManager } from "./manager";
import { attachTerminal } from "./attach";
import { matchRunRoute } from "./routes";
import { RunStore } from "./store";
import { storeRunCapability, type RunSessionContext } from "./store-capability";
import { nodePtySpawner, type PtySpawn } from "./node-pty";
import { PtyHost } from "./pty-host";

export type RunMount = {
  store: RunStore;
  manager: RunManager;
  handle(method: string, tail: string, input: Record<string, unknown>, context: () => RunSessionContext): Promise<unknown> | undefined;
  watch(sessionId: string, listener: (event: RunStatusEvent) => void): () => void;
  attach(input: Record<string, unknown>, context: () => RunSessionContext): (send: (frame: RunStreamFrame) => void) => () => void;
  shutdown(): Promise<void>;
};

export function personClosedNote(run: RunView): string {
  return `The person closed terminal "${run.title}" (${run.terminalId}). Do not reopen it unless they ask.`;
}

export function createRunMount(options: {
  root: string;
  version?: string;
  spawnPty?: PtySpawn;
  noteForNextTurn?: (sessionId: string, note: string) => void;
}): RunMount {
  const dir = path.join(options.root, "run");
  fs.mkdirSync(dir, { recursive: true });
  const store = new RunStore(dir);
  const spawnPty = options.spawnPty ?? availablePty();
  const host = spawnPty ? new PtyHost({ spawnPty, version: options.version }) : undefined;
  const manager = new RunManager({
    shellDir: path.join(dir, "shell"),
    ...(host ? { launcher: terminalLauncher(host) } : {}),
    ...(options.noteForNextTurn ? { personClosed: (run: RunView) => options.noteForNextTurn!(run.sessionId, personClosedNote(run)) } : {}),
  });

  return {
    store,
    manager,
    handle(method, tail, input, context) {
      const matched = matchRunRoute(method, tail);
      if (!matched) return undefined;
      return matched.route.handle({
        params: matched.params,
        input,
        capability: storeRunCapability({ store, manager, context }),
      });
    },
    watch(sessionId, listener) {
      return manager.watch((event) => {
        if (event.sessionId === sessionId) listener(event);
      });
    },
    attach: (input, context) => attachTerminal(manager, context().sessionId, input),
    async shutdown() {
      await manager.shutdown();
      await host?.dispose();
    },
  };
}

function availablePty(): PtySpawn | undefined {
  try {
    return nodePtySpawner();
  } catch {
    return undefined;
  }
}
