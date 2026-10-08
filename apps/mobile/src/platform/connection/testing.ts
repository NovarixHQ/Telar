import type { Clock } from "./clock";
import type { ConnectionState, HostConnection } from "./host-connection";

export function fakeClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    after(ms, run) {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.run();
    },
  };
}

type Answer = Response | "unreachable" | "hang";
type Handler = (path: string, init: RequestInit) => Answer;

/** A network of Macs keyed by origin; an origin with no handler is unreachable. */
export function fakeNetwork(macs: Record<string, Handler>) {
  const seen: { url: string; method: string; authorization?: string }[] = [];
  const fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    seen.push({ url: String(input), method: init.method ?? "GET", authorization: (init.headers as Record<string, string> | undefined)?.authorization });
    const answer = macs[url.origin]?.(url.pathname, init) ?? "unreachable";
    if (answer === "unreachable") return Promise.reject(new TypeError("Network request failed"));
    if (answer === "hang") {
      return new Promise<Response>((_, reject) => {
        const signal = init.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    }
    return Promise.resolve(answer);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

export const identityOf = (hostId: string, addresses: string[] = []) => Response.json({ hostId, name: "Mini", appVersion: "0.1.0", addresses });

export function until(connection: HostConnection, kind: ConnectionState["kind"]): Promise<ConnectionState> {
  return new Promise((resolve) => {
    if (connection.state.kind === kind) return resolve(connection.state);
    const stop = connection.subscribe(() => {
      if (connection.state.kind !== kind) return;
      stop();
      resolve(connection.state);
    });
  });
}
