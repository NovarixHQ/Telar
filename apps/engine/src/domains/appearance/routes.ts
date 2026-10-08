import type http from "node:http";
import { HttpError, matchesETag } from "../../platform/http/http";
import { notModified, ok, type Route, type RouteAnswer } from "../../platform/http/route";
import type { EngineStore } from "../../state";

// The appearance carries its layers' pixels, so this one route reads up to 8 MiB.
const MAX_APPEARANCE_UPLOAD_BYTES = 8 * 1024 * 1024;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Refused before buffering: a declared length past the cap ends the connection without reading a byte.
async function appearanceBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const tooLarge = () => new HttpError(413, "invalid_request", `appearance must be under ${MAX_APPEARANCE_UPLOAD_BYTES} bytes`, true);
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_APPEARANCE_UPLOAD_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_APPEARANCE_UPLOAD_BYTES) throw tooLarge();
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) throw new HttpError(400, "invalid_request", "request body must be an object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_request", "request body is invalid JSON");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new HttpError(400, "invalid_request", "request body must be an object");
  }
  return parsed as Record<string, unknown>;
}

const appearanceEtag = (updatedAt: number): string => `"a${updatedAt.toString(36)}"`;

const ALLOWED = ["GET", "PUT", "DELETE"];

const refused = (): RouteAnswer => ({
  status: 405,
  body: { error: { code: "invalid_request", message: "appearance accepts GET, PUT and DELETE" } },
  headers: { allow: ALLOWED.join(", ") },
});

/** The host's one appearance, which every connected window wears, cacheable by ETag. */
export function appearanceRoutes(store: EngineStore): Route[] {
  return [
    {
      method: "GET",
      path: "/v2/appearance",
      auth: "engine",
      handle({ request }) {
        const stored = store.appearance.get();
        if (!stored) return ok({ appearance: null, updatedAt: null });
        const etag = appearanceEtag(stored.updatedAt);
        if (matchesETag(request.headers["if-none-match"], etag)) return notModified(etag);
        return { status: 200, body: { appearance: stored.blob, updatedAt: stored.updatedAt }, headers: { etag } };
      },
    },
    {
      method: "PUT",
      path: "/v2/appearance",
      auth: "engine",
      body: "raw",
      async handle({ request }) {
        const written = store.appearance.set(await appearanceBody(request));
        const etag = appearanceEtag(written.updatedAt);
        return { status: 200, body: { ok: true, updatedAt: written.updatedAt, etag }, headers: { etag } };
      },
    },
    {
      method: "DELETE",
      path: "/v2/appearance",
      auth: "engine",
      body: "raw",
      handle() {
        store.appearance.clear();
        return ok({ ok: true });
      },
    },
    ...METHODS.filter((method) => !ALLOWED.includes(method)).map((method): Route => ({ method, path: "/v2/appearance", auth: "engine", body: "raw", handle: refused })),
  ];
}
