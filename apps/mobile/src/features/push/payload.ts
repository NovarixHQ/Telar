export type SessionRef = { hostId: string; sessionId: string };
export type DeliveredAlert = { identifier: string; threadIdentifier?: string | null; url?: unknown };

const RECONCILE_BATCH = 64;

/** The engine's `telar://session?host=&id=` link, as a ref. */
export function sessionOfUrl(url: unknown): SessionRef | undefined {
  if (typeof url !== "string") return undefined;
  const match = /^telar:\/\/session\?(.*)$/.exec(url);
  if (!match) return undefined;
  const query = new URLSearchParams(match[1]);
  const hostId = query.get("host");
  const sessionId = query.get("id");
  return hostId && sessionId ? { hostId, sessionId } : undefined;
}

/** The app's own route for a session, which navigation's linking config resolves. */
export const sessionLink = ({ hostId, sessionId }: SessionRef) => `telar://session/${encodeURIComponent(hostId)}/${encodeURIComponent(sessionId)}`;

/** A Live Activity's or an alert's `telar://session?host=&id=` as the app's route, naming the paired host it means; other links pass through. */
export function appLink(url: string, paired: string[]): string {
  const ref = sessionOfUrl(url);
  return ref ? sessionLink({ ...ref, hostId: pairedHostOf(ref.hostId, paired) ?? ref.hostId }) : url;
}

/** Alerts are threaded as `<hostId>:<sessionId>`; older ones only carry the url. */
export function sessionOfAlert(alert: DeliveredAlert): SessionRef | undefined {
  const thread = alert.threadIdentifier ?? "";
  const colon = thread.indexOf(":");
  if (colon > 0 && colon < thread.length - 1) return { hostId: thread.slice(0, colon), sessionId: thread.slice(colon + 1) };
  return sessionOfUrl(alert.url);
}

/** A silent `{read: {host, sessions}}` push names sessions read on another device. */
export function readsOf(payload: unknown): SessionRef[] {
  const read = (payload as { read?: { host?: unknown; sessions?: unknown } } | null)?.read;
  if (typeof read?.host !== "string" || !Array.isArray(read.sessions)) return [];
  const hostId = read.host;
  return read.sessions.filter((id): id is string => typeof id === "string" && id !== "").map((sessionId) => ({ hostId, sessionId }));
}

/** The engine names itself `host_<uuid>` but takes only the bare UUID in a push registration, and echoes that back. */
export const pushHostId = (hostId: string) => hostId.replace(/^host_/, "").toUpperCase();

export const pairedHostOf = (pushId: string, paired: string[]) => paired.find((hostId) => pushHostId(hostId) === pushHostId(pushId));

const key = (ref: SessionRef) => `${pushHostId(ref.hostId)}:${ref.sessionId}`;

export function alertsToRemove(delivered: DeliveredAlert[], clearing: SessionRef[]): string[] {
  const keys = new Set(clearing.map(key));
  if (keys.size === 0) return [];
  return delivered.filter((alert) => {
    const ref = sessionOfAlert(alert);
    return ref !== undefined && keys.has(key(ref));
  }).map((alert) => alert.identifier);
}

/** The sessions to ask each host about, at most 64 per host. */
export function reconcileQueries(delivered: DeliveredAlert[]): Map<string, string[]> {
  const queries = new Map<string, string[]>();
  for (const alert of delivered) {
    const ref = sessionOfAlert(alert);
    if (!ref) continue;
    const ids = queries.get(ref.hostId) ?? [];
    if (ids.length < RECONCILE_BATCH && !ids.includes(ref.sessionId)) ids.push(ref.sessionId);
    queries.set(ref.hostId, ids);
  }
  return queries;
}

export type Approval = SessionRef & { requestId: string };

export function approvalOf(payload: unknown): Approval | undefined {
  const { url, request } = (payload ?? {}) as { url?: unknown; request?: unknown };
  const ref = sessionOfUrl(url);
  return ref && typeof request === "string" && request !== "" ? { ...ref, requestId: request } : undefined;
}
