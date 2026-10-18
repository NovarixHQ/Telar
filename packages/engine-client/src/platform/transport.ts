import type { EngineErrorBody, EngineErrorCode } from "../protocol/events";
import { EngineClientError } from "./errors";

export type Conditional<T> = { unchanged: true; etag?: string } | { unchanged: false; payload: T; etag?: string };

/** What a domain's client methods run on. */
export type EngineTransport = {
  request<T>(method: string, pathname: string, body?: unknown, signal?: AbortSignal, operation?: string): Promise<T>;
  requestIfChanged<T>(pathname: string, etag?: string, operation?: string, signal?: AbortSignal): Promise<Conditional<T>>;
  readBytes(pathAndQuery: string): Promise<{ data: Uint8Array; contentType: string }>;
};

export const COCKPIT_API = "/api/engine";

export function enginePathOf(pathname: string): string | undefined {
  return pathname.startsWith(`${COCKPIT_API}/v2/`) ? pathname.slice(COCKPIT_API.length) : undefined;
}

export type Send = (pathname: string, init: RequestInit & { headers?: Record<string, string> }, operation?: string) => Promise<Response>;

export type Fail = (code: EngineErrorCode, message: string, status: number | undefined, details: { operation?: string; transport?: string; response: Response }) => Error;

const failWithClientError: Fail = (code, message, status, { operation, transport }) =>
  new EngineClientError(code, message, status, { ...(operation === undefined ? {} : { operation }), ...(transport === undefined ? {} : { transport }) });

export function httpTransport(send: Send, fail: Fail = failWithClientError): EngineTransport & { parse<T>(response: Response, operation?: string): Promise<T> } {
  async function parse<T>(response: Response, operation?: string): Promise<T> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw fail("engine_unavailable", "engine returned an invalid response", response.status, { ...(operation === undefined ? {} : { operation }), transport: "malformed_response", response });
    }
    if (!response.ok) {
      const error = (payload as EngineErrorBody | null)?.error;
      throw fail(error?.code ?? "engine_unavailable", error?.message ?? "engine request failed", response.status, { ...(operation === undefined ? {} : { operation }), response });
    }
    return payload as T;
  }
  return {
    parse,
    async request<T>(method: string, pathname: string, body?: unknown, signal?: AbortSignal, operation?: string) {
      const json = body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      return parse<T>(await send(pathname, { method, ...json, ...(signal ? { signal } : {}) }, operation), operation);
    },
    async requestIfChanged<T>(pathname: string, etag?: string, operation?: string, signal?: AbortSignal) {
      const response = await send(pathname, { method: "GET", headers: etag ? { "if-none-match": etag } : {}, ...(signal ? { signal } : {}) }, operation);
      const tag = response.headers.get("etag") ?? undefined;
      if (response.status === 304) return { unchanged: true as const, ...(tag ? { etag: tag } : {}) };
      return { unchanged: false as const, payload: await parse<T>(response, operation), ...(tag ? { etag: tag } : {}) };
    },
    async readBytes(pathAndQuery: string) {
      const response = await send(pathAndQuery, { method: "GET" });
      if (!response.ok) {
        const error = ((await response.json().catch(() => null)) as EngineErrorBody | null)?.error;
        throw fail(error?.code ?? "engine_unavailable", error?.message ?? "engine request failed", response.status, { response });
      }
      return { data: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
    },
  };
}
