import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EngineClient } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";
import { engineHome, removeTmp, repo, tmp } from "../../../test/worktree-fixtures";

let daemon: EngineDaemon;
let base: string;
let full: string;
let observer: string;

const engine = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((response) => response.json() as Promise<Record<string, any>>);

let nextId = 1;
const mcp = (token: string | undefined, method: string, params: Record<string, unknown> = {}) =>
  fetch(`${base}/v2/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

const toolNames = async (token: string) => ((await (await mcp(token, "tools/list")).json()).result.tools as { name: string }[]).map((tool) => tool.name).sort();
const call = async (token: string, name: string, args: Record<string, unknown> = {}) =>
  (await (await mcp(token, "tools/call", { name, arguments: args })).json()).result as { content: { text: string }[]; isError?: boolean };

beforeAll(async () => {
  daemon = await startEngine({ models: stubModels, engineRoot: engineHome("telar-connector-"), remoteDir: tmp("telar-connector-remote-"), notifier: () => true });
  base = `http://${daemon.discovery.host}:${daemon.discovery.port}`;
  await new EngineClient(daemon.discovery).registerProject({ id: "project_connector", name: "Connector", root: repo() });
  full = (await engine("PATCH", "/v2/remote", { requireAuth: true, device: { name: "Assistant" } })).deviceToken;
  const { code } = await engine("POST", "/v2/remote/pairing");
  const paired = await engine("POST", "/v2/remote/pair", { code, name: "Viewer" });
  observer = paired.deviceToken;
  await engine("PATCH", `/v2/remote/devices/${paired.deviceId}`, { role: "observer" });
});

afterAll(async () => {
  await daemon?.close();
  removeTmp();
});

describe("the connector MCP door", () => {
  test("initialize answers a paired device with the server's identity", async () => {
    const response = await mcp(full, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "telar" } });
  });

  test("a missing, unknown or engine token is refused", async () => {
    expect((await mcp(undefined, "tools/list")).status).toBe(401);
    expect((await mcp("tlr_not-a-device", "tools/list")).status).toBe(401);
    expect((await mcp(daemon.discovery.token, "tools/list")).status).toBe(401);
  });

  test("a full device lists reads and writes; a view-only one only reads", async () => {
    expect(await toolNames(full)).toEqual(["schedules_list", "sessions_capabilities", "sessions_create", "sessions_list", "sessions_read", "sessions_requests", "sessions_send", "sessions_settle", "sessions_stop"]);
    expect(await toolNames(observer)).toEqual(["schedules_list", "sessions_capabilities", "sessions_list", "sessions_read", "sessions_requests"]);
  });

  test("a read tool answers both roles", async () => {
    for (const token of [full, observer]) {
      const result = await call(token, "sessions_list");
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain("project_connector");
    }
  });

  test("a view-only device can neither call a write tool nor answer a request", async () => {
    expect((await (await mcp(observer, "tools/call", { name: "sessions_create", arguments: { projectId: "project_connector" } })).json()).error.code).toBe(-32602);
    const answer = await call(observer, "sessions_requests", { sessionId: "session_x", requestId: "request_x", decision: "accept" });
    expect(answer.isError).toBe(true);
  });

  test("GET opens no stream and DELETE ends nothing", async () => {
    expect((await fetch(`${base}/v2/mcp`, { headers: { authorization: `Bearer ${full}` } })).status).toBe(405);
    expect((await fetch(`${base}/v2/mcp`, { method: "DELETE", headers: { authorization: `Bearer ${full}` } })).status).toBe(200);
  });
});
