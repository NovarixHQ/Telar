import type { LiveSessionsAnswer } from "@telar/engine-client";
import { desktopAttached, desktopNotices, desktopStream, dismissDesktop, emptyDesktopState, type Channel, type DesktopState } from "./desktop";
import { readCleared } from "./read-sync";
import { signals } from "./worker";

export type PairedHost = { id: string; baseUrl: string; deviceToken: string };
export type HostWatch = { states: Map<string, DesktopState>; etags: Map<string, string>; shown: Map<string, Set<string>> };

const HOST_POLL_MS = 10_000;
const HOST_TIMEOUT_MS = 10_000;

export const hostPath = (hostId: string, path: string): string =>
  path.startsWith("/projects/") ? `/hosts/${encodeURIComponent(hostId)}${path}` : "/";

type PollOptions = { fetcher?: typeof fetch; channel?: Channel; now?: number };

export async function pollHost(host: PairedHost, watch: HostWatch, options: PollOptions = {}): Promise<void> {
  const { fetcher = fetch, channel = desktopStream, now = Date.now() } = options;
  const etag = watch.etags.get(host.id);
  const live = await fetcher(`${host.baseUrl}/api/sessions/live?all=1`, {
    headers: { authorization: `Bearer ${host.deviceToken}`, ...(etag === undefined ? {} : { "if-none-match": etag }) },
    signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
  });
  if (!live.ok) return;
  const answer = (await live.json()) as LiveSessionsAnswer;
  const nextTag = live.headers.get("etag");
  if (nextTag) watch.etags.set(host.id, nextTag);
  const sessions = signals(answer.sessions, answer.assignments, answer.projects, now);
  const { notices, state } = desktopNotices(watch.states.get(host.id) ?? emptyDesktopState(), sessions, undefined);
  watch.states.set(host.id, state);
  const shown = watch.shown.get(host.id) ?? new Set<string>();
  watch.shown.set(host.id, shown);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const id of shown) {
    const session = byId.get(id);
    if (session && !readCleared(session)) continue;
    shown.delete(id);
    dismissDesktop(id, channel);
  }
  for (const notice of notices) {
    shown.add(notice.sessionId);
    channel.send({ ...notice, path: hostPath(host.id, notice.path) });
  }
}

export function watchHosts(hosts: () => PairedHost[], fetcher: typeof fetch = fetch): () => void {
  const watch: HostWatch = { states: new Map(), etags: new Map(), shown: new Map() };
  let running = false;
  const tick = async () => {
    if (running || !desktopAttached()) return;
    running = true;
    try {
      await Promise.all(hosts().map((host) => pollHost(host, watch, { fetcher }).catch(() => {})));
    } catch {
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), HOST_POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
