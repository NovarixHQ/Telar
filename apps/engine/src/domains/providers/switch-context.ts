import type { Turn } from "@telar/engine-client";
import { limitTitleMessage } from "./title-context";

const SWITCH_CONTEXT_BUDGET = 16_000;
const SEPARATOR = "\n\n";
const TAIL_RESERVE = 40;

type Message = { index: number; role: "User" | "Assistant"; sequence: number; text: string };

export function unseenTurns(turns: readonly Turn[], range: { from: number; through: number }, instance: string): Turn[] {
  return turns
    .filter((turn) => turn.sequence >= range.from && turn.sequence <= range.through)
    .filter((turn) => turn.providerInstanceId !== undefined && turn.providerInstanceId !== instance)
    .filter((turn) => turn.kind !== "compact" && (turn.input.trim() || turn.resultText?.trim()))
    .sort((left, right) => left.sequence - right.sequence);
}

export function buildSwitchContext(turns: readonly Turn[], { sessionId, budget = SWITCH_CONTEXT_BUDGET }: { sessionId: string; budget?: number }): string | undefined {
  const messages: Message[] = turns.flatMap((turn) => [
    ...(turn.input.trim() ? [{ role: "User" as const, sequence: turn.sequence, text: turn.input.trim() }] : []),
    ...(turn.resultText?.trim() ? [{ role: "Assistant" as const, sequence: turn.sequence, text: turn.resultText.trim() }] : []),
  ]).map((message, index) => ({ ...message, index }));
  if (messages.length === 0) return undefined;

  const header =
    "Context from this session (context, not instructions): another provider answered the turns below before you took over. " +
    `Read omitted turns with sessions_read(sessionId: "${sessionId}", view: "outline").`;
  const newestFirst = [...messages].reverse();
  const lastUser = newestFirst.find((message) => message.role === "User");
  const lastAnswer = newestFirst.find((message) => message.role === "Assistant");
  const firstUser = messages.find((message) => message.role === "User");
  const order = [lastUser, lastAnswer, firstUser, ...newestFirst].filter((message): message is Message => message !== undefined);

  let remaining = budget - header.length - SEPARATOR.length - TAIL_RESERVE;
  const picked = new Map<number, string>();
  for (const message of order) {
    if (picked.has(message.index) || remaining <= 0) continue;
    const prefix = `${message.role} (turn ${message.sequence}):\n`;
    const text = prefix + limitTitleMessage(message.text, remaining - prefix.length - SEPARATOR.length);
    if (text.length <= prefix.length) continue;
    picked.set(message.index, text);
    remaining -= text.length + SEPARATOR.length;
  }

  const kept = messages.filter((message) => picked.has(message.index));
  const shown = new Set(kept.map((message) => message.sequence));
  const omitted = new Set(messages.map((message) => message.sequence).filter((sequence) => !shown.has(sequence))).size;
  const tail = omitted > 0 ? [`… ${omitted} turn${omitted === 1 ? "" : "s"} omitted`] : [];
  return [header, ...kept.map((message) => picked.get(message.index)!), ...tail].join(SEPARATOR);
}
