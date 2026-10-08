import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { TELAR_BROWSER_MCP_SERVER, TELAR_MCP_SERVER } from "@telar/engine-client";
import type { DriverRun } from "../contract";

type NameValue = { name: string; value: string };
type AcpMcpServer = { name: string; command: string; args: string[]; env: NameValue[] };

const BRIDGE_LEASE = "TELAR_MCP_BRIDGE_LEASE";

export type Lease = { url: string; token: string };

// The socket's token rotates between turns but `session/new` is sent once, so the bridge rereads a lease file the driver rewrites.
export function writeLease(file: string, lease: Lease): void {
  fs.writeFileSync(file, JSON.stringify({ url: lease.url, token: lease.token }), { mode: 0o600 });
}

function bridge(name: string, leaseFile: string): AcpMcpServer {
  const env = [{ name: BRIDGE_LEASE, value: leaseFile }];
  if (process.env.ELECTRON_RUN_AS_NODE) env.push({ name: "ELECTRON_RUN_AS_NODE", value: process.env.ELECTRON_RUN_AS_NODE });
  return { name, command: process.execPath, args: process.argv[1] ? [process.argv[1]] : [], env };
}

export function acpMcpServers(run: DriverRun, leaseDir: string): AcpMcpServer[] {
  const servers: AcpMcpServer[] = [];
  const telar: Array<[string, { url: string; token: string } | undefined]> = [
    [TELAR_BROWSER_MCP_SERVER, run.browserSocket],
    [TELAR_MCP_SERVER, run.telarSocketLease],
  ];
  for (const [name, lease] of telar) {
    if (!lease) continue;
    const file = path.join(leaseDir, `${name}.json`);
    writeLease(file, lease);
    servers.push(bridge(name, file));
  }
  return servers;
}

export const isMcpBridgeProcess = (): boolean => Boolean(process.env[BRIDGE_LEASE]);

export async function runMcpBridge(
  input: NodeJS.ReadableStream = process.stdin,
  write: (line: string) => void = (line) => void process.stdout.write(`${line}\n`),
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const leaseFile = process.env[BRIDGE_LEASE]!;
  let sessionId: string | undefined;
  const inFlight = new Set<Promise<void>>();
  const relay = async (line: string): Promise<void> => {
    let id: unknown;
    try {
      id = (JSON.parse(line) as { id?: unknown }).id;
      const { url, token } = JSON.parse(fs.readFileSync(leaseFile, "utf8")) as Lease;
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: line,
      });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      const body = await response.text();
      if (response.status === 202 || !body.trim()) return;
      const lines = response.headers.get("content-type")?.includes("text/event-stream")
        ? body.split("\n").filter((entry) => entry.startsWith("data:")).map((entry) => entry.slice(5).trim())
        : [body.trim()];
      for (const entry of lines) if (entry) write(entry);
    } catch (error) {
      if (id !== undefined) write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: `Telar's tools are unreachable: ${error instanceof Error ? error.message : String(error)}` } }));
    }
  };
  for await (const line of readline.createInterface({ input })) {
    if (!line.trim()) continue;
    const task = relay(line).finally(() => inFlight.delete(task));
    inFlight.add(task);
  }
  await Promise.all(inFlight);
}
