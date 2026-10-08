import type { Item, Session, Turn } from "@telar/engine-client";
import { buildSwitchContext, unseenTurns } from "../providers/switch-context";

type SwitchRow = Extract<Item["detail"], { type: "provider_switch" }>;

export function stampClaimProvider(session: Session, history: () => readonly Turn[], turn: Turn): SwitchRow | undefined {
  const instance = session.providerInstanceId;
  turn.providerInstanceId = instance;
  // No watermarks yet means one provider has answered everything so far.
  const seen = session.providerSeen ? (session.providerSeen[instance] ?? 0) : turn.sequence - 1;
  if (!turn.carried && seen < turn.sequence - 1) turn.carried = { from: seen + 1, through: turn.sequence - 1 };
  session.providerSeen = { ...session.providerSeen, [instance]: Math.max(seen, turn.sequence) };

  const from = session.switchedFrom;
  delete session.switchedFrom;
  if (!from || from.instanceId === instance) return undefined;
  return {
    type: "provider_switch",
    from,
    to: { driver: session.driver, instanceId: instance, ...(session.model?.model ? { model: session.model.model } : {}) },
    carriedTurns: turn.carried ? unseenTurns(history(), turn.carried, instance).length : 0,
  };
}

export function carriedContext(sessionId: string, history: () => readonly Turn[], turn: Turn): string | undefined {
  if (!turn.carried || !turn.providerInstanceId) return undefined;
  return buildSwitchContext(unseenTurns(history(), turn.carried, turn.providerInstanceId), { sessionId });
}

export function switchItem(sessionId: string, turn: Turn, detail: SwitchRow, at: number): Item {
  const label = (side: SwitchRow["from"]) => (side.model ? `${side.driver} · ${side.model}` : side.driver);
  return {
    id: `switch_${turn.runId}`,
    runId: turn.runId,
    sessionId,
    status: "completed",
    title: `Switched from ${label(detail.from)} to ${label(detail.to)}`,
    detail,
    startedAt: at,
    completedAt: at,
  };
}
