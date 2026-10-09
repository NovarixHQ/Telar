import type { createEmitter } from "./emitter";
import { type UsageSnapshot } from "@telar/engine-client";
import { type TurnState, type Rest } from "./turn";

export type WaitCtx = {
  turn: TurnState;
  emit: ReturnType<typeof createEmitter>["emit"];
};

export const decorateUsage = (ctx: WaitCtx, snapshot: UsageSnapshot | undefined): UsageSnapshot | undefined =>
  snapshot === undefined
    ? undefined
    : {
        ...snapshot,
        ...(ctx.turn.contextUsed === undefined ? {} : { contextUsed: ctx.turn.contextUsed }),
        ...(ctx.turn.contextMax === undefined ? {} : { contextMax: ctx.turn.contextMax }),
      };

export const closeProviderWait = (ctx: WaitCtx): void => {
  if (!ctx.turn.waitItemId) return;
  ctx.emit({ kind: "item.completed", itemId: ctx.turn.waitItemId, status: "completed" });
  ctx.turn.waitItemId = undefined;
};

export function bindProviderWait(ctx: WaitCtx) {
  return {
    decorateUsage: (...args: Rest<typeof decorateUsage>) => decorateUsage(ctx, ...args),
    closeProviderWait: (...args: Rest<typeof closeProviderWait>) => closeProviderWait(ctx, ...args),
  };
}
