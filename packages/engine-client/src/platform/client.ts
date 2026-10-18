import type { TurnAttachment } from "../protocol/common";
import type { EngineDiscovery, EngineHealth, EventPage } from "../protocol/events";
import { queryOf, sessionPath } from "../sessions/client";
import type { LiveSessionsAnswer } from "../sessions/schema";
import { runBytesStreamPath, type RunTargetInput } from "../terminal/client";
import { domainClients, type EngineDomainMethods } from "./domains";
import { EngineClientError, sanitizeTransportCause } from "./errors";
import { httpTransport, type Conditional, type EngineTransport } from "./transport";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Stream = { url: string; headers: Record<string, string> };

export type EngineEndpoint = { baseUrl: () => string; token: string };

export interface EngineClient extends EngineDomainMethods {}

export class EngineClient implements EngineTransport {
  constructor(
    private readonly target: EngineDiscovery | EngineEndpoint,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private readonly http = httpTransport((pathname, init, operation) => this.send(pathname, init, operation));

  request<T>(method: string, pathname: string, body?: unknown, signal?: AbortSignal, operation?: string): Promise<T> {
    return this.http.request(method, pathname, body, signal, operation);
  }

  readBytes(pathAndQuery: string): Promise<{ data: Uint8Array; contentType: string }> {
    return this.http.readBytes(pathAndQuery);
  }

  health(): Promise<EngineHealth> {
    return this.request("GET", "/v2/health");
  }

  sessionsStream(): Stream {
    return this.locate("/v2/sessions/stream");
  }

  runBytesStream(sessionId: string, input: RunTargetInput & { after?: number } = {}): Stream {
    return this.locate(runBytesStreamPath(sessionId, input));
  }

  ds<T>(sessionId: string, method: string, body?: unknown): Promise<T> {
    return this.request("POST", `${sessionPath(sessionId)}/ds/${method}`, body ?? {});
  }

  plugin<T>(sessionId: string, pluginId: string, method: string, body?: unknown): Promise<T> {
    return this.request("POST", `${sessionPath(sessionId)}/plugins/${pluginId}/${method}`, body ?? {});
  }

  async liveSessionsMatching(
    options: { etag?: string; all?: boolean; shelf?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ notModified: true; etag: string } | (LiveSessionsAnswer & { notModified?: false; etag?: string })> {
    const path = options.shelf ? "/v2/sessions/live?all=1&shelf=1" : options.all ? "/v2/sessions/live?all=1" : "/v2/sessions/live";
    const read = await this.requestIfChanged<LiveSessionsAnswer>(path, options.etag, "liveSessionsMatching", options.signal);
    if (read.unchanged) return { notModified: true, etag: read.etag ?? options.etag ?? "" };
    return { ...read.payload, ...(read.etag === undefined ? {} : { etag: read.etag }) };
  }

  eventsIfChanged(sessionId: string, after = 0, limit?: number, etag?: string): Promise<Conditional<EventPage>> {
    return this.requestIfChanged<EventPage>(`${sessionPath(sessionId)}/events${queryOf({ after, limit })}`, etag);
  }

  async uploadAttachment(sessionId: string, file: { name: string; mediaType: string; data: ArrayBuffer | Uint8Array }): Promise<{ attachment: TurnAttachment }> {
    const response = await this.send(`${sessionPath(sessionId)}/attachments`, {
      method: "POST",
      headers: {
        "content-type": file.mediaType || "application/octet-stream",
        // Encoded: a filename may hold a newline, which would end the header block.
        "x-telar-attachment-name": encodeURIComponent(file.name),
      },
      // A fresh copy: `BodyInit` refuses a view whose buffer may be shared.
      body: new Uint8Array(file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data)) as unknown as BodyInit,
    });
    return this.http.parse(response);
  }

  locate(pathname: string): Stream {
    const base = "baseUrl" in this.target ? this.target.baseUrl().replace(/\/$/, "") : `http://${this.target.host}:${this.target.port}`;
    return { url: `${base}${pathname}`, headers: { authorization: `Bearer ${this.target.token}` } };
  }

  private async send(pathname: string, init: RequestInit & { headers?: Record<string, string> }, operation?: string): Promise<Response> {
    const { url, headers } = this.locate(pathname);
    try {
      return await this.fetchImpl(url, { ...init, headers: { ...headers, ...init.headers } });
    } catch (cause) {
      // An abort is the caller hanging up, not the engine being away.
      if ((cause as { name?: unknown } | null)?.name === "AbortError") throw cause;
      const transport = sanitizeTransportCause(cause);
      throw new EngineClientError("engine_unavailable", "engine is unreachable", undefined, { ...(operation === undefined ? {} : { operation }), ...(transport ? { transport } : {}) });
    }
  }

  requestIfChanged<T>(pathname: string, etag?: string, operation?: string, signal?: AbortSignal): Promise<Conditional<T>> {
    return this.http.requestIfChanged(pathname, etag, operation, signal);
  }
}

Object.assign(EngineClient.prototype, ...domainClients);
