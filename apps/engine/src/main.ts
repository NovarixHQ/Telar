import { runEngine } from "./run";
import { isMcpBridgeProcess, runMcpBridge } from "./drivers/acp/mcp-bridge";

if (isMcpBridgeProcess()) process.exit(await runMcpBridge().then(() => 0));

function networkFromEnv(): { network?: { host: string; port?: number } } {
  const host = process.env.TELAR_ENGINE_HOST?.trim();
  if (!host) return {};
  const port = Number(process.env.TELAR_ENGINE_PORT);
  return { network: { host, ...(Number.isInteger(port) && port > 0 ? { port } : {}) } };
}

await runEngine(networkFromEnv());
