import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { errorFor, HttpError } from "./http";
import { router } from "./router";
import { createStaticHandler, placeholderPath } from "./static";

let dir: string;
let server: http.Server | undefined;

const FILES: Record<string, string> = {
  "index.html": "<p>home</p>",
  "settings.html": "<p>settings</p>",
  "projects/_/sessions/_.html": "<p>session</p>",
  "projects/_/sessions/_.txt": "payload",
  "projects/_/sessions/_/solo.html": "<p>solo</p>",
  "projects/_/sessions/new.html": "<p>new</p>",
  "hosts/_/projects/_/sessions/_.html": "<p>host session</p>",
  "_next/static/chunks/app.js": "console.log(1)",
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-static-"));
  for (const [name, content] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  fs.writeFileSync(path.join(path.dirname(dir), "secret.txt"), "outside");
});

afterEach(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(dir), "secret.txt"), { force: true });
});

async function start(): Promise<string> {
  server = http.createServer(
    router([], {
      authorize: () => {
        throw new HttpError(401, "engine_unauthorized", "no");
      },
      errorFor: (error) => errorFor(error),
      staticFiles: createStaticHandler(dir),
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

test("a real session, solo, new-session and host path each serve their placeholder page", async () => {
  const base = await start();
  const body = async (pathname: string) => (await fetch(base + pathname)).text();
  expect(await body("/")).toBe("<p>home</p>");
  expect(await body("/settings")).toBe("<p>settings</p>");
  expect(await body("/projects/project_1/sessions/session_9")).toBe("<p>session</p>");
  expect(await body("/projects/project_1/sessions/session_9/solo")).toBe("<p>solo</p>");
  expect(await body("/projects/project_1/sessions/new")).toBe("<p>new</p>");
  expect(await body("/hosts/host_2/projects/project_1/sessions/session_9")).toBe("<p>host session</p>");
  expect(await body("/projects/project_1/sessions/session_9.txt")).toBe("payload");
});

test("hashed assets are immutable, html is revalidated and an unchanged file answers 304", async () => {
  const base = await start();
  const asset = await fetch(`${base}/_next/static/chunks/app.js`);
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(asset.headers.get("content-type")).toContain("text/javascript");

  const page = await fetch(`${base}/settings`);
  expect(page.headers.get("cache-control")).toBe("no-cache");
  expect(page.headers.get("x-content-type-options")).toBe("nosniff");
  const again = await fetch(`${base}/settings`, { headers: { "if-none-match": page.headers.get("etag")! } });
  expect(again.status).toBe(304);
});

test("a missing file falls through to the router and nothing outside the directory is served", async () => {
  const base = await start();
  expect((await fetch(`${base}/missing.js`)).status).toBe(401);
  expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(401);
  const raw = await new Promise<string>((resolve) => {
    const socket = http.request(base, { method: "GET", path: "/../secret.txt" }, (response) => resolve(String(response.statusCode)));
    socket.end();
  });
  expect(raw).not.toBe("200");
  expect((await fetch(`${base}/settings`, { method: "POST" })).status).toBe(401);
});

test("only the segments after projects, sessions and hosts become placeholders", () => {
  expect(placeholderPath("/projects/a/sessions/b/solo")).toBe("/projects/_/sessions/_/solo");
  expect(placeholderPath("/projects/a/sessions/new")).toBe("/projects/_/sessions/new");
  expect(placeholderPath("/settings")).toBe("/settings");
});
