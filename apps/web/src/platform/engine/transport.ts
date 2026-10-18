import { httpTransport, type Conditional, type EngineTransport } from "@telar/engine-client";
import type {
EngineErrorCode
} from "@telar/engine-client";
import { hostFromPathname, hostName, HOST_NAME_HEADER, LOCAL_HOST_ID, pinnedHost, type Fetcher } from "@/platform/engine/host-client";

export type EngineApiErrorCode = EngineErrorCode | "cockpit_unauthorized";

/** WHICH MAC AN ANSWER CAME FROM. `id` is this cockpit's own id for it (the one
 *  in the URL); `name` is what that Mac calls itself, when it has said. */
export type ErrorHost = { id: string; name?: string };

export class EngineApiError extends Error {
  constructor(
    readonly code: EngineApiErrorCode,
    message: string,
    readonly status?: number,
    readonly host?: ErrorHost,
  ) {
    super(message);
    this.name = "EngineApiError";
  }
}

/** The cause itself when the engine raised it, otherwise an internal error carrying `fallback`. */
export function asEngineError(cause: unknown, fallback: string): EngineApiError {
  return cause instanceof EngineApiError ? cause : new EngineApiError("internal_error", fallback);
}

/** The Mac to name in a failure, or nothing when this one answered. The UI
 *  shows the name when the Mac has given one, and falls back to the id rather
 *  than to silence — an id at least distinguishes two paired Macs. */
export function refusedBy(error: EngineApiError): string | undefined {
  if (!error.host || error.host.id === LOCAL_HOST_ID) return undefined;
  return error.host.name ?? error.host.id;
}


/** What the request reached, as opposed to what it meant to reach: the pin on
 *  the fetcher, corrected by the name the proxy stamped on the way back. */
function answeringHost(fetcher: Fetcher, response?: Response): ErrorHost | undefined {
  const id = pinnedHost(fetcher);
  if (!id || id === LOCAL_HOST_ID) return undefined;
  const name = response?.headers.get(HOST_NAME_HEADER) ?? hostName(id);
  return name ? { id, name } : { id };
}

export const READ_BUDGET = 2;

export const OPEN_BUDGET = 1;

function gate(budget: number) {
  let live = 0;
  const queued: Array<() => void> = [];
  return {
    /** Take a slot, waiting in line when the budget is spent. */
    async take(): Promise<void> {
      if (live < budget) {
        live += 1;
        return;
      }
      await new Promise<void>((resolve) => queued.push(resolve));
    },
    give(): void {
      const next = queued.shift();
      if (next) {
        next();
        return;
      }
      live -= 1;
    },
  };
}

export type Gate = ReturnType<typeof gate>;

const reads = gate(READ_BUDGET);

/** The opening's own slot. Exported for the cockpit's sake only in the sense
 *  that `sessionBootstrap` below is the single caller — nothing else may take
 *  it, or it stops being the thing that makes an opening never wait. */
export const opens = gate(OPEN_BUDGET);

const FAILURE_TEXT: Record<string, string> = {
  "engine returned an invalid response": "The engine adapter returned an invalid response.",
  "engine request failed": "The engine request failed.",
};

function cockpitTransport(fetcher: Fetcher) {
  return httpTransport(
    (pathname, init) => reach(fetcher, pathname, init),
    (code, message, status, { response }) =>
      new EngineApiError(code, FAILURE_TEXT[message] ?? message, status, answeringHost(fetcher, response)),
  );
}

export async function request<T>(
  fetcher: Fetcher,
  method: string,
  pathname: string,
  body?: unknown,
  signal?: AbortSignal,
  lane: Gate | null = reads,
): Promise<T> {
  const budgeted = lane !== null && method === "GET" && signal === undefined;
  if (budgeted) await lane.take();
  try {
    return await cockpitTransport(fetcher).request<T>(method, pathname, body, signal);
  } finally {
    if (budgeted) lane.give();
  }
}

export async function requestIfChanged<T>(fetcher: Fetcher, pathname: string, etag?: string, lane: Gate | null = reads): Promise<Conditional<T>> {
  if (lane) await lane.take();
  try {
    return await cockpitTransport(fetcher).requestIfChanged<T>(pathname, etag);
  } finally {
    lane?.give();
  }
}

function askedThisCockpit(fetcher: Fetcher, pathname: string): boolean {
  if (typeof window === "undefined" || window.location.pathname === "/pair" || pathname.startsWith("/v2/hosts/")) return false;
  return (pinnedHost(fetcher) ?? hostFromPathname(window.location.pathname)) === LOCAL_HOST_ID;
}

async function refusedAsUnpaired(response: Response): Promise<boolean> {
  const payload = (await response.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return payload?.error?.code === "cockpit_unauthorized";
}

async function reach(fetcher: Fetcher, pathname: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetcher(pathname, init);
    if (response.status === 401 && askedThisCockpit(fetcher, pathname) && (await refusedAsUnpaired(response))) window.location.replace("/pair");
    return response;
  } catch (cause) {
    // An abort is the CALLER's decision arriving back, not the adapter being
    // away — it must surface as itself so the UI can say "Stopped".
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    // A remote hop that throws here never reached this cockpit's proxy, so the
    // sentence about a "local adapter" would name the wrong machine.
    const host = answeringHost(fetcher);
    throw new EngineApiError(
      "engine_unavailable",
      host ? `The cockpit cannot reach ${host.name ?? "that computer"}.` : "The cockpit cannot reach its local adapter.",
      undefined,
      host,
    );
  }
}

/** Runs the package's per-domain methods through this engine. `lane: null` skips the read budget. */
export function apiTransport(fetcher: Fetcher, lane: Gate | null = reads): EngineTransport {
  return {
    request: (method, pathname, body, signal) => request(fetcher, method, pathname, body, signal, lane),
    requestIfChanged: (pathname, etag) => requestIfChanged(fetcher, pathname, etag, lane),
    readBytes: (pathAndQuery) => cockpitTransport(fetcher).readBytes(pathAndQuery),
  };
}
