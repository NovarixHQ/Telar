import type { RunStreamFrame } from "@telar/engine-client";
import type { RunManager } from "./manager";
import { parseByteCursor } from "./routes";
import { targetRun } from "./store-capability";

export function attachTerminal(manager: RunManager, sessionId: string, input: Record<string, unknown>): (send: (frame: RunStreamFrame) => void) => () => void {
  const { after = 0, ...target } = parseByteCursor(input);
  const { terminalId } = targetRun(manager, sessionId, target, "read");
  return (send) => {
    const run = manager.run(terminalId);
    send({ type: "run.status", projectId: run.projectId, sessionId: run.sessionId, run });
    const { chunks, cursor, dropped } = manager.bytes(terminalId, after);
    send({ type: "run.bytes", data: chunks.join(""), cursor, dropped });
    const stopBytes = manager.watchBytes((id, frame) => {
      if (id === terminalId) send(frame);
    });
    const stopStatus = manager.watch((event) => {
      if (event.run.terminalId === terminalId) send(event);
    });
    return () => {
      stopBytes();
      stopStatus();
    };
  };
}
