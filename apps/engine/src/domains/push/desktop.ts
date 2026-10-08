import { cockpitSessionHref } from "@telar/engine-client";
import { ALERT_BODY, alertKind, signalKey, type AlertKind, type SessionSignal } from "./push";

export const DESKTOP_NOTICE = "telar:desktop-notification";
export const DESKTOP_APPROVE = "telar:desktop-notification:approve";
export const DESKTOP_APPROVED = "telar:desktop-notification:approved";
export const DESKTOP_PRESENCE = "telar:desktop-presence";
export const DESKTOP_DISMISS = "telar:desktop-notification:dismiss";

export type DesktopNotice = {
  type: typeof DESKTOP_NOTICE;
  kind: AlertKind;
  sessionId: string;
  title: string;
  body: string;
  path: string;
  request?: string;
};

export type Presence = { active: boolean; viewingPath: string | null; at: number };
export const PRESENCE_STALE_MS = 45_000;

export const presentNow = (presence: Presence | undefined, now: number): presence is Presence =>
  presence !== undefined && presence.active && now - presence.at >= 0 && now - presence.at <= PRESENCE_STALE_MS;

export type DesktopState = { seen: Record<string, string>; baselined: boolean; offered: Record<string, string> };
export const emptyDesktopState = (): DesktopState => ({ seen: {}, baselined: false, offered: {} });

export function desktopNotices(
  state: DesktopState,
  sessions: readonly SessionSignal[],
  changed: ReadonlySet<string> | undefined,
): { notices: DesktopNotice[]; state: DesktopState } {
  const next: DesktopState = { seen: { ...state.seen }, baselined: true, offered: { ...state.offered } };
  const notices: DesktopNotice[] = [];
  for (const session of sessions) {
    if (changed && !changed.has(session.id) && session.id in state.seen) continue;
    const kind = alertKind(session, state.seen[session.id] ?? (state.baselined ? "new:0:0:false" : undefined), true);
    next.seen[session.id] = signalKey(session);
    if (state.seen[session.id] !== signalKey(session)) delete next.offered[session.id];
    if (!kind) continue;
    const request = kind === "blocked" ? session.approvable : undefined;
    if (request) next.offered[session.id] = request;
    notices.push({
      type: DESKTOP_NOTICE, kind, sessionId: session.id,
      title: session.title.slice(0, 160),
      body: ALERT_BODY[kind],
      path: cockpitSessionHref(session),
      ...(request ? { request } : {}),
    });
  }
  const ids = new Set(sessions.map((s) => s.id));
  for (const id of Object.keys(next.seen)) if (!ids.has(id)) delete next.seen[id];
  for (const id of Object.keys(next.offered)) if (!ids.has(id)) delete next.offered[id];
  return { notices, state: next };
}

export type Channel = { send(message: unknown): void; readonly connected: boolean };

export function createDesktopStream() {
  const subscribers = new Set<{ write(chunk: string): unknown }>();
  return {
    get connected() {
      return subscribers.size > 0;
    },
    send(message: unknown) {
      const frame = `data: ${JSON.stringify(message)}\n\n`;
      for (const subscriber of subscribers) subscriber.write(frame);
    },
    subscribe(subscriber: { write(chunk: string): unknown }): () => void {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}
export const desktopStream = createDesktopStream();
type Resolve = (sessionId: string, requestId: string, input: { decision: "accept" }) => Promise<unknown>;

const desktopGlobal = globalThis as typeof globalThis & {
  telarDesktopNotify?: DesktopState;
  telarDesktopPresence?: Presence;
};

export function desktopAttached(channel: Channel = desktopStream): boolean {
  return channel.connected;
}

export const desktopInUse = (now = Date.now()): boolean => presentNow(desktopGlobal.telarDesktopPresence, now);

export function notifyDesktop(sessions: readonly SessionSignal[], changed: ReadonlySet<string> | undefined, channel: Channel = desktopStream): void {
  const { notices, state } = desktopNotices(desktopGlobal.telarDesktopNotify ?? emptyDesktopState(), sessions, changed);
  desktopGlobal.telarDesktopNotify = state;
  for (const notice of notices) channel.send(notice);
}

const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
export async function handleDesktopMessage(message: unknown, resolve: Resolve, channel: Channel = desktopStream, state = desktopGlobal.telarDesktopNotify, now = Date.now()): Promise<void> {
  if (!message || typeof message !== "object") return;
  const { type, sessionId, requestId, active, viewingPath } = message as Record<string, unknown>;
  if (type === DESKTOP_PRESENCE) {
    const viewing = viewingPath === null || (typeof viewingPath === "string" && viewingPath.startsWith("/") && viewingPath.length <= 1024) ? viewingPath : undefined;
    if (typeof active === "boolean" && viewing !== undefined) desktopGlobal.telarDesktopPresence = { active, viewingPath: viewing, at: now };
    return;
  }
  if (type !== DESKTOP_APPROVE || !validId(sessionId) || !validId(requestId)) return;
  let ok = false;
  if (state && state.offered[sessionId] === requestId) {
    delete state.offered[sessionId];
    try { await resolve(sessionId, requestId, { decision: "accept" }); ok = true; } catch { }
  }
  channel.send({ type: DESKTOP_APPROVED, sessionId, requestId, ok });
}

export function dismissDesktop(sessionId: string, channel: Channel = desktopStream): void {
  if (!validId(sessionId) || !desktopAttached(channel)) return;
  channel.send({ type: DESKTOP_DISMISS, sessionId });
}
