import type http from "node:http";
import { z } from "zod";
import type { DeviceScope } from "@telar/engine-client";
import { collectTools, handleSocketMessage, json, mcpSocketRoute, type SocketTool } from "../agent-tools";
import type { EngineStore } from "../../state";
import { sessionsCapability, storeReads, storeSessionsPort } from "./capability";
import { collectSessionsWallTools } from "./tools/socket";
import { RETIRED_TOOLS } from "./tools/shared";

const CONNECTOR_SERVER = { name: "telar", version: "1.0.0", retired: RETIRED_TOOLS };
const READS = ["sessions_list", "sessions_read", "sessions_capabilities", "sessions_requests"];
const WRITES = ["sessions_create", "sessions_send", "sessions_stop", "sessions_settle"];

type DeviceLookup = (authorization: string | undefined) => { id: string; scopes: DeviceScope[] } | undefined;

function schedulesTool(store: EngineStore): SocketTool[] {
  return collectTools(
    (tool) => [
      tool("schedules_list", "Scheduled prompts: which session each runs in, its rule, whether it is on and when it next fires.", { sessionId: z.string().min(1).optional() }, async (args) =>
        json({ schedules: store.schedules.list(typeof args.sessionId === "string" ? args.sessionId : undefined) }),
      ),
    ],
    undefined,
  );
}

function readOnly(tool: SocketTool): SocketTool {
  if (tool.name !== "sessions_requests") return tool;
  return { ...tool, description: "The permission prompts a session is waiting on.", shape: { sessionId: tool.shape.sessionId } };
}

function connectorTools(store: EngineStore): Record<"full" | "observer", SocketTool[]> {
  const wall = collectSessionsWallTools(sessionsCapability(storeSessionsPort(store), undefined, storeReads(store)));
  const pick = (names: string[]) => wall.filter((tool) => names.includes(tool.name));
  const schedules = schedulesTool(store);
  return {
    full: [...pick([...READS, ...WRITES]), ...schedules],
    observer: [...pick(READS).map(readOnly), ...schedules],
  };
}

export function connectorDoor(store: EngineStore, lookup: DeviceLookup) {
  let tools: Record<"full" | "observer", SocketTool[]> | undefined;
  const device = (request: http.IncomingMessage) => lookup(request.headers.authorization);
  return {
    device,
    route: mcpSocketRoute("/v2/mcp", "device", "connector", (message, request) => {
      tools ??= connectorTools(store);
      return handleSocketMessage(tools[device(request)?.scopes.includes("write") ? "full" : "observer"], message, CONNECTOR_SERVER);
    }),
  };
}
