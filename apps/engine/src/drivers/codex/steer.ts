import crypto from "node:crypto";
import type { TurnObservation } from "@telar/engine-client";
import { framedSteerText, steerRowDetail, steerRowTitle } from "../../domains/turns";
import type { SteerMailbox, SteerMessage } from "../../domains/turns";
import type { CodexAppServer } from "./app-server";
import { codexNotificationInstruction, codexTurnInput } from "./thread";
import { codexRowId, type CodexTurn } from "./turn";

// `turn/steer` has no developer channel, so a steered notification carries its header in the text.
function steerText(message: SteerMessage): string {
  return message.notification ? codexNotificationInstruction(message.notification, framedSteerText(message)) : framedSteerText(message);
}

/** Sends steered messages into the running turn until the mailbox closes. A refusal becomes an error row. */
export async function pumpCodexSteers(
  steer: SteerMailbox,
  client: CodexAppServer,
  turn: CodexTurn,
  emit: (observation: TurnObservation) => void,
): Promise<void> {
  for (;;) {
    await steer.wake();
    const queued = steer.drain();
    if (queued.length === 0) {
      if (steer.isClosed) return;
      continue;
    }
    const files = queued.flatMap((message) => message.attachments ?? []);
    const text = queued.map(steerText).join("\n\n");
    for (const message of queued) {
      const rowId = codexRowId(`steer-${crypto.randomUUID().slice(0, 8)}`);
      emit({ kind: "item.started", item: { id: rowId, detail: steerRowDetail(message), title: steerRowTitle(message) } });
      emit({ kind: "item.completed", itemId: rowId, status: "completed" });
    }
    try {
      await client.request("turn/steer", { threadId: turn.threadId, expectedTurnId: turn.turnId, input: codexTurnInput(text, files) });
    } catch (error) {
      const errorId = codexRowId(`steer-error-${crypto.randomUUID().slice(0, 8)}`);
      const message = `The sent-now message could not reach the running turn: ${error instanceof Error ? error.message : String(error)}`;
      emit({ kind: "item.started", item: { id: errorId, detail: { type: "error", error: { message } } } });
      emit({ kind: "item.completed", itemId: errorId, status: "failed" });
    }
  }
}
