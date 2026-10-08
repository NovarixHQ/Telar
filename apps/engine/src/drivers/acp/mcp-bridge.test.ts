import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { runMcpBridge, writeLease } from "./mcp-bridge";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-bridge-"));
const leaseFile = path.join(dir, "telar.json");

afterEach(() => {
  delete process.env.TELAR_MCP_BRIDGE_LEASE;
});

async function relay(lines: string[], answer: (body: string, headers: Record<string, string>) => Response | Promise<Response>) {
  process.env.TELAR_MCP_BRIDGE_LEASE = leaseFile;
  const written: string[] = [];
  const seen: Array<Record<string, string>> = [];
  const doFetch = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    seen.push(headers);
    return answer(String(init.body), headers);
  }) as unknown as typeof fetch;
  await runMcpBridge(Readable.from(lines.map((line) => `${line}\n`)), (line) => void written.push(line), doFetch);
  return { written, seen };
}

test("each request is posted with the current lease's token and its answer comes back as a line", async () => {
  writeLease(leaseFile, { url: "http://127.0.0.1:9/mcp", token: "t-1" });
  const { written, seen } = await relay(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}', '{"jsonrpc":"2.0","method":"notifications/initialized"}'], (body) =>
    body.includes('"id":1') ? Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } }, { headers: { "mcp-session-id": "m-1" } }) : new Response(null, { status: 202 }),
  );
  expect(written).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}']);
  expect(seen[0]).toMatchObject({ authorization: "Bearer t-1" });
});

test("an unreachable socket answers the request with an error instead of leaving the agent waiting", async () => {
  writeLease(leaseFile, { url: "http://127.0.0.1:9/mcp", token: "t-1" });
  const { written } = await relay(['{"jsonrpc":"2.0","id":7,"method":"tools/call"}'], () => {
    throw new Error("connection refused");
  });
  expect(JSON.parse(written[0]!)).toMatchObject({ id: 7, error: { code: -32603, message: expect.stringContaining("connection refused") } });
});
