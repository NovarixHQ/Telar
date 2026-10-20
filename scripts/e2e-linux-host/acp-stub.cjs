// A stand-in agent speaking ACP over stdio. It echoes the prompt; "browse <url>" drives the engine's browser tools first.
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const SESSION = "e2e-stub-session";
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const say = (text) => send({ method: "session/update", params: { sessionId: SESSION, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
let servers = [];

function mcpClient(server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ...Object.fromEntries(server.env.map((v) => [v.name, v.value])) }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let next = 1;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, (message) => (message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { call, close: () => child.kill() };
}

async function browse(url) {
  for (const server of servers) {
    const mcp = mcpClient(server);
    try {
      await mcp.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-stub", version: "1" } });
      const { tools } = await mcp.call("tools/list", {});
      if (!tools.some((tool) => tool.name === "browser_navigate")) continue;
      await mcp.call("tools/call", { name: "browser_navigate", arguments: { url } });
      const snapshot = await mcp.call("tools/call", { name: "browser_snapshot", arguments: {} });
      return snapshot.content.map((part) => part.text ?? "").join("\n");
    } finally {
      mcp.close();
    }
  }
  return `no browser tools among ${servers.map((server) => server.name).join(", ") || "no servers"}`;
}

async function prompt(id, params) {
  const text = params.prompt.map((part) => part.text ?? "").join("");
  const url = /browse (\S+)/.exec(text)?.[1];
  try {
    say(url ? `snapshot:\n${await browse(url)}` : `echo:${text.split("\n").at(-1)}`);
  } catch (error) {
    say(`browse failed: ${error.message}`);
  }
  send({ id, result: { stopReason: "end_turn" } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  else if (message.method === "session/new") {
    servers = message.params.mcpServers ?? [];
    send({ id: message.id, result: { sessionId: SESSION } });
  } else if (message.method === "session/prompt") void prompt(message.id, message.params);
  else if (message.id !== undefined && message.method) send({ id: message.id, error: { code: -32601, message: "not supported" } });
});
