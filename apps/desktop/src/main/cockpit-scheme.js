const fs = require("node:fs");
const path = require("node:path");

const SCHEME = "telar";
const APP_HOST = "app";
const APP_URL = `${SCHEME}://${APP_HOST}/`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const PARAMETER_PARENTS = new Set(["projects", "sessions", "hosts"]);
const DROPPED_REQUEST_HEADERS = new Set(["host", "origin", "referer", "cookie", "authorization", "connection"]);
const DROPPED_RESPONSE_HEADERS = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection"]);

function registerCockpitScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

function placeholderPath(pathname) {
  const segments = pathname.split("/");
  return segments.map((segment, index) => (index > 1 && segment !== "new" && PARAMETER_PARENTS.has(segments[index - 1]) ? "_" : segment)).join("/");
}

function candidates(pathname) {
  const extension = path.posix.extname(pathname);
  if (extension === ".txt" || extension === ".html") {
    return [pathname, `${placeholderPath(pathname.slice(0, -extension.length))}${extension}`];
  }
  if (extension) return [pathname];
  const stem = pathname.replace(/\/$/, "");
  const mapped = placeholderPath(stem);
  return [...new Set([`${stem}.html`, `${stem}/index.html`, `${mapped}.html`, `${mapped}/index.html`])];
}

async function resolveFile(root, pathname) {
  for (const candidate of candidates(pathname)) {
    const file = path.join(root, candidate);
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    try {
      if ((await fs.promises.stat(file)).isFile()) return file;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function serveStatic(root, method, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const file = await resolveFile(root, decoded);
  if (!file) return undefined;
  const immutable = decoded.startsWith("/_next/static/");
  return new Response(method === "HEAD" ? null : await fs.promises.readFile(file), {
    headers: {
      ...SECURITY_HEADERS,
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}

const textResponse = (status, text) => new Response(text, { status, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" } });

async function proxyToEngine(request, url, engine, fetchImpl) {
  const endpoint = engine();
  if (!endpoint) return textResponse(503, "the engine is not running");
  const headers = new Headers();
  for (const [name, value] of request.headers) if (!DROPPED_REQUEST_HEADERS.has(name)) headers.set(name, value);
  headers.set("authorization", `Bearer ${endpoint.token}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body;
  let upstream;
  try {
    upstream = await fetchImpl(`http://${endpoint.host}:${endpoint.port}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      redirect: "manual",
      signal: request.signal,
      ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    });
  } catch {
    return textResponse(502, "the engine did not answer");
  }
  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) if (!DROPPED_RESPONSE_HEADERS.has(name)) responseHeaders.set(name, value);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

function createCockpitHandler({ staticDir, engine, fetchImpl }) {
  const root = path.resolve(staticDir);
  return async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return textResponse(404, "not found");
    if (url.pathname.startsWith("/v2/") || url.pathname.startsWith("/api/")) return proxyToEngine(request, url, engine, fetchImpl);
    if (request.method !== "GET" && request.method !== "HEAD") return textResponse(405, "method not allowed");
    return (await serveStatic(root, request.method, url.pathname)) ?? textResponse(404, "not found");
  };
}

function serveCockpit(ses, { net, ...options }) {
  ses.protocol.handle(SCHEME, createCockpitHandler({ ...options, fetchImpl: (url, init) => net.fetch(url, init) }));
}

function serveDevCockpit(ses, { net, origin, engine }) {
  ses.protocol.handle("http", (request) => {
    const url = new URL(request.url);
    if (url.origin === origin && (url.pathname.startsWith("/v2/") || url.pathname.startsWith("/api/"))) {
      return proxyToEngine(request, url, engine, (target, init) => net.fetch(target, init));
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

module.exports = { APP_URL, createCockpitHandler, registerCockpitScheme, serveCockpit, serveDevCockpit };
