import fs from "node:fs";
import type http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
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
};

const HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const PARAMETER_PARENTS = new Set(["projects", "sessions", "hosts"]);

/** `/projects/p1/sessions/s1/solo` is the export's `projects/_/sessions/_/solo`; `new` stays a literal. */
export function placeholderPath(pathname: string): string {
  const segments = pathname.split("/");
  return segments.map((segment, index) => (index > 1 && segment !== "new" && PARAMETER_PARENTS.has(segments[index - 1]!) ? "_" : segment)).join("/");
}

function candidates(pathname: string): string[] {
  const extension = path.posix.extname(pathname);
  if (extension === ".txt" || extension === ".html") {
    const stem = placeholderPath(pathname.slice(0, -extension.length));
    return [pathname, `${stem}${extension}`];
  }
  if (extension) return [pathname];
  const stem = pathname.replace(/\/$/, "");
  const mapped = placeholderPath(stem);
  return [...new Set([`${stem}.html`, `${stem}/index.html`, `${mapped}.html`, `${mapped}/index.html`])];
}

function resolveFile(root: string, pathname: string): string | undefined {
  for (const candidate of candidates(pathname)) {
    const file = path.join(root, candidate);
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Serves the exported cockpit. Returns false when nothing in `staticDir` answers the request. */
export function createStaticHandler(staticDir: string): (request: http.IncomingMessage, response: http.ServerResponse, pathname: string) => boolean {
  const root = path.resolve(staticDir);
  return (request, response, pathname) => {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (decoded.includes("\0")) return false;
    const file = resolveFile(root, decoded);
    if (!file) return false;
    const stat = fs.statSync(file);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const immutable = decoded.startsWith("/_next/static/");
    const headers = {
      ...HEADERS,
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      etag,
    };
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, headers).end();
      return true;
    }
    response.writeHead(200, { ...headers, "content-length": stat.size });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
    return true;
  };
}
