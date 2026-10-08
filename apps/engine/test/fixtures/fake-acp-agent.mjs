#!/usr/bin/env bun
import fs from "node:fs";
import readline from "node:readline";

const script = process.env.ACP_FAKE_SCRIPT ?? "plain";
const log = process.env.ACP_FAKE_LOG;
const SESSION = "fake-acp-session";
let nextId = 1000;
const waiting = new Map();
let cancelled = () => {};

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (body) => send({ method: "session/update", params: { sessionId: SESSION, update: body } });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
const chunk = (text) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });

const replay = process.env.ACP_FAKE_REPLAY
  ? fs.readFileSync(process.env.ACP_FAKE_REPLAY, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : undefined;
let cursor = 0;

function playUntilNextRequest(liveId, recordedId) {
  while (cursor < replay.length && replay[cursor].direction === "in") {
    const line = { ...replay[cursor++].line };
    if (line.id === recordedId && !line.method) line.id = liveId;
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
}

async function prompt(id) {
  switch (script) {
    case "tools": {
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Looking around." } });
      update({ sessionUpdate: "plan", entries: [{ content: "list files", priority: "high", status: "in_progress" }] });
      update({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "ls", kind: "execute", status: "pending", rawInput: { command: "ls" } });
      const answer = await ask("session/request_permission", {
        sessionId: SESSION,
        toolCall: { toolCallId: "call-1", title: "ls", kind: "execute", rawInput: { command: "ls" } },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      });
      const allowed = answer.outcome?.optionId === "yes";
      update({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: allowed ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text: allowed ? "a.txt" : "denied" } }] });
      update({ sessionUpdate: "plan", entries: [{ content: "list files", priority: "high", status: "completed" }] });
      chunk(allowed ? "Found a.txt" : "Not allowed");
      return send({ id, result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } } });
    }
    case "unknown":
      update({ sessionUpdate: "mystery_update", detail: 1 });
      chunk("still here");
      return send({ id, result: { stopReason: "end_turn" } });
    case "hang":
      return update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "working" } });
    case "cancel":
      cancelled = () => send({ id, result: { stopReason: "cancelled" } });
      return update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "working" } });
    case "crash":
      process.exit(3);
      return;
    default:
      chunk("hel");
      chunk("lo");
      update({ sessionUpdate: "usage_update", used: 1200, size: 200000 });
      return send({ id, result: { stopReason: "end_turn" } });
  }
}

const options = () =>
  script === "options"
    ? [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "fast", options: [{ value: "fast", name: "Fast" }, { value: "smart", name: "Smart" }] }]
    : [];

readline.createInterface({ input: process.stdin }).on("line", (raw) => {
  if (!raw.trim()) return;
  const message = JSON.parse(raw);
  if (log) fs.appendFileSync(log, `${raw}\n`);
  if (replay) {
    const recorded = replay[cursor];
    if (recorded?.direction === "out") cursor++;
    return playUntilNextRequest(message.id, recorded?.line.id);
  }
  if (message.method === undefined) return waiting.get(message.id)?.(message.result ?? {});
  switch (message.method) {
    case "initialize":
      return send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: script === "images" }, mcpCapabilities: { http: false } } } });
    case "session/new":
      return send({ id: message.id, result: { sessionId: SESSION, configOptions: options() } });
    case "session/set_config_option":
      if (message.params.value === "smart") return send({ id: message.id, error: { code: -32602, message: "smart is not available on this plan" } });
      return send({ id: message.id, result: { configOptions: options() } });
    case "session/prompt":
      return void prompt(message.id);
    case "session/cancel":
      return cancelled();
    default:
      if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: `fake agent does not implement ${message.method}` } });
  }
});
