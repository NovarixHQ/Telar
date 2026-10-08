import type { LiveSessionsAnswer } from "@telar/engine-client";
import { desktopAttached, desktopNotices, desktopStream, emptyDesktopState, type Channel, type DesktopState } from "./desktop";
import { signals } from "./worker";

export type PairedHost = { id: string; baseUrl: string; deviceToken: string };
export type HostWatch = { states: Map<string, DesktopState>; etags: Map<string, string> };

const HOST_POLL_MS = 10_000;
const HOST_TIMEOUT_MS = 10_000;

export const hostPath = (hostId: string, path: string): string =>
  path.startsWith("/projects/") ? `/hosts/${encodeURIComponent(hostId)}${path}` : "/";

type PollOptions = { fetcher?: typeof fetch; channel?: Channel; now?: number };

async function hostInUse(host: PairedHost, fetcher: typeof fetch): Promise<boolean> {
  try {
    const answer = await fetcher(`${host.baseUrl}/api/mobile/presence`, {
      method: "PUT",
      headers: { authorization: `Bearer ${host.deviceToken}` },
      signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
    });
    return answer.ok && ((await answer.json()) as { hostInUse?: unknown }).hostInUse === true;
  } catch {
    return false;
  }
}

export async function pollHost(host: PairedHost, watch: HostWatch, options: PollOptions = {}): Promise<void> {
  const { fetcher = fetch, channel = desktopStream, now = Date.now() } = options;
  const inUse = await hostInUse(host, fetcher);
  const etag = watch.etags.get(host.id);
  const live = await fetcher(`${host.baseUrl}/api/sessions/live?all=1`, {
    headers: { authorization: `Bearer ${host.deviceToken}`, ...(etag === undefined ? {} : { "if-none-match": etag }) },
    signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
  });
  if (!live.ok) return;
  const answer = (await live.json()) as LiveSessionsAnswer;
  const nextTag = live.headers.get("etag");
  if (nextTag) watch.etags.set(host.id, nextTag);
  const { notices, state } = desktopNotices(watch.states.get(host.id) ?? emptyDesktopState(), signals(answer.sessions, answer.assignments, answer.projects, now), undefined);
  watch.states.set(host.id, state);
  if (inUse) return;
  for (const notice of notices) channel.send({ ...notice, path: hostPath(host.id, notice.path) });
}

export function watchHosts(hosts: () => PairedHost[], fetcher: typeof fetch = fetch): () => void {
  const watch: HostWatch = { states: new Map(), etags: new Map() };
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
