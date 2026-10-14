import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/mcp/route";
import { startEngine, type EngineDaemon } from "../../../../../engine/src/daemon";

const saved = { home: process.env.TELAR_HOME, cockpit: process.env.TELAR_COCKPIT };
let home: string;
let daemon: EngineDaemon;
let deviceToken: string;

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-web-mcp-"));
  process.env.TELAR_HOME = home;
  process.env.TELAR_COCKPIT = "1";
  daemon = await startEngine({ engineRoot: path.join(home, "engine") });
  const minted = await fetch(`http://${daemon.discovery.host}:${daemon.discovery.port}/v2/remote`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
    body: JSON.stringify({ requireAuth: true, device: { name: "Assistant" } }),
  });
  deviceToken = ((await minted.json()) as { deviceToken: string }).deviceToken;
});

afterAll(async () => {
  await daemon?.close();
  fs.rmSync(home, { recursive: true, force: true });
  for (const [key, value] of [["TELAR_HOME", saved.home], ["TELAR_COCKPIT", saved.cockpit]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const list = (authorization?: string) =>
  POST(
    new Request("http://mac.tail1234.ts.net/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );

test("the caller's own device token reaches the engine's MCP door", async () => {
  const response = await list(`Bearer ${deviceToken}`);
  expect(response.status).toBe(200);
  expect(((await response.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);
});

test("without a device token the engine refuses, rather than the cockpit lending its own", async () => {
  expect((await list()).status).toBe(401);
  expect((await list("Bearer tlr_unknown")).status).toBe(401);
});
