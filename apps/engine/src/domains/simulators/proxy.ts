import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fail, type Route } from "../../platform/http/route";

const ALLOWED = [
  /^\/api\/devices$/,
  /^\/vendor\/serve-sim\/api$/,
  /^\/vendor\/serve-sim\/api\/screenshot$/,
  /^\/vendor\/serve-sim\/api\/event-log(\/events)?$/,
  /^\/vendor\/serve-sim\/helper\/[^/]+\/(stream\.mjpeg|stream\.avcc|config|health|ax|foreground)$/,
  /^\/vendor\/serve-sim\/appstate$/,
  /^\/vendor\/serve-emu\/api\/(devices|screenshot|stream-mode|stream-settings|accessibility|fold)$/,
  /^\/vendor\/serve-emu\/health$/,
];
const MUTABLE = [/^\/vendor\/serve-sim\/api\/screenshot$/, /^\/vendor\/serve-emu\/api\/(screenshot|stream-mode|stream-settings|fold)$/];
const FORWARDED_REQUEST = ["accept", "accept-language", "content-type", "range", "if-none-match", "last-event-id"];
const DROPPED_RESPONSE = new Set(["content-encoding", "transfer-encoding", "connection", "content-length"]);

export function hubProxyRoute(origin: () => string | undefined, fetchImpl: typeof fetch = fetch): Route {
  return {
    method: "*",
    path: /^\/v2\/simulators\/hub(\/.*)$/,
    auth: "engine",
    body: "raw",
    async handle({ params, query, request, response }) {
      const hubPath = params[0]!;
      const method = (request.method ?? "GET").toUpperCase();
      const reads = method === "GET" || method === "HEAD";
      if (!ALLOWED.some((pattern) => pattern.test(hubPath))) return fail(404, "not_found", "That simulator hub route is not exposed.");
      if (!reads && !MUTABLE.some((pattern) => pattern.test(hubPath))) return fail(405, "invalid_request", `${method} is not allowed on that simulator hub route.`);
      const hub = origin();
      if (!hub) return fail(503, "provider_unavailable", "The simulator hub is not running.");
      const search = new URLSearchParams(query);
      search.delete("ticket");
      const headers = new Headers();
      for (const name of FORWARDED_REQUEST) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      if (request.headers.origin) headers.set("origin", hub);
      const abort = new AbortController();
      response.once("close", () => abort.abort());
      let upstream: Response;
      try {
        upstream = await fetchImpl(`${hub}${hubPath}${search.size ? `?${search}` : ""}`, {
          method,
          headers,
          redirect: "manual",
          signal: abort.signal,
          ...(reads ? {} : { body: Readable.toWeb(request) as unknown as ReadableStream, duplex: "half" }),
        } as RequestInit);
      } catch {
        return fail(502, "provider_unavailable", "The simulator hub did not answer.");
      }
      const out: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!DROPPED_RESPONSE.has(name)) out[name] = value;
      });
      out["cache-control"] = "no-store, no-transform";
      response.writeHead(upstream.status, out);
      if (!upstream.body || method === "HEAD") {
        response.end();
        return undefined;
      }
      await pipeline(Readable.fromWeb(upstream.body as never), response).catch(() => undefined);
      return undefined;
    },
  };
}
