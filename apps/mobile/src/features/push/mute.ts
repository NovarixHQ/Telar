import { pushHostId, sessionOfUrl, type SessionRef } from "./payload";

export const MUTED_KEY = "telar.notifications.muted";

/** Swift keeps muted sessions as their `telar://session?host=&id=` links, so the stored list reads the same in both apps. */
const linkOf = ({ hostId, sessionId }: SessionRef) => `telar://session?host=${encodeURIComponent(pushHostId(hostId))}&id=${encodeURIComponent(sessionId)}`;

export const mutedList = (stored: unknown): string[] => (Array.isArray(stored) ? stored.filter((link): link is string => typeof link === "string") : []);

export const isMutedIn = (muted: readonly string[], ref: SessionRef) => muted.includes(linkOf(ref));

export const toggledMute = (muted: readonly string[], ref: SessionRef): string[] =>
  isMutedIn(muted, ref) ? muted.filter((link) => link !== linkOf(ref)) : [...muted, linkOf(ref)];

/** The session ids one host must keep quiet. */
export function mutedSessionsOf(muted: readonly string[], hostId: string): string[] {
  return muted.flatMap((link) => {
    const ref = sessionOfUrl(link);
    return ref && pushHostId(ref.hostId) === pushHostId(hostId) ? [ref.sessionId] : [];
  });
}
