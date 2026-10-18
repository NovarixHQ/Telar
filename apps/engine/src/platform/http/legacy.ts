import type http from "node:http";
import { HttpError, rawBody } from "./http";
import { fail, type Route } from "./route";
import { matchRoute } from "./router";

type Input = Parameters<Route["handle"]>[0];

function target(routes: readonly Route[], method: string, path: string): { route: Route; params: string[] } {
  const matched = matchRoute(routes, method, path);
  if (!matched) throw new Error(`legacy alias has no target: ${method} ${path}`);
  return matched;
}

/** The paths released iOS builds and older hosts still call. Remove on 2027-01-31. */
type Caller = (request: http.IncomingMessage) => { device?: { id: string; scopes: readonly string[] } };

const PUSH_REGISTRATION_MAX_BYTES = 32768;

function mobileRoutes(routes: readonly Route[], callerOf: Caller): Route[] {
  const read = target(routes, "GET", "/v2/push/read-state");
  const unpaired = () => fail(401, "engine_unauthorized", "Pair this device first.");
  const devicePath = (id: string) => `/v2/push/devices/${encodeURIComponent(id)}`;
  return [
    {
      method: "GET",
      path: "/v2/mobile/push",
      auth: "engine",
      handle(input: Input) {
        const device = callerOf(input.request).device;
        if (!device) return unpaired();
        const found = target(routes, "GET", devicePath(device.id));
        return found.route.handle({ ...input, params: found.params });
      },
    },
    {
      method: "PUT",
      path: "/v2/mobile/push",
      auth: "engine",
      body: "raw",
      async handle(input: Input) {
        const device = callerOf(input.request).device;
        if (!device) return unpaired();
        if (!device.scopes.includes("write")) return fail(403, "engine_unauthorized", "Write access is required.");
        let registration: Record<string, unknown>;
        try {
          registration = JSON.parse((await rawBody(input.request, PUSH_REGISTRATION_MAX_BYTES)).toString("utf8")) as Record<string, unknown>;
        } catch (error) {
          return error instanceof HttpError ? fail(413, "invalid_request", "Registration too large.") : fail(400, "invalid_request", "Invalid push registration.");
        }
        const found = target(routes, "PUT", devicePath(device.id));
        return found.route.handle({ ...input, params: found.params, body: registration });
      },
    },
    {
      method: "GET",
      path: "/v2/mobile/read-state",
      auth: "engine",
      handle: (input: Input) => (callerOf(input.request).device ? read.route.handle({ ...input, params: [] }) : unpaired()),
    },
  ];
}

export function legacyRoutes(routes: readonly Route[], callerOf: Caller): Route[] {
  const listSessions = target(routes, "GET", "/v2/sessions");
  const createSession = target(routes, "POST", "/v2/sessions");
  const conversations = target(routes, "GET", "/v2/claude/conversations");
  const projectSessions = /^\/v2\/projects\/([^/]+)\/sessions$/;
  return [
    ...mobileRoutes(routes, callerOf),
    { method: "GET", path: projectSessions, auth: listSessions.route.auth, handle: (input: Input) => listSessions.route.handle({ ...input, params: [], query: new URLSearchParams({ projectId: input.params[0]! }) }) },
    { method: "POST", path: projectSessions, auth: createSession.route.auth, handle: (input: Input) => createSession.route.handle({ ...input, params: [], body: { ...input.body, projectId: input.params[0]! } }) },
    { method: "GET", path: "/v2/claude-conversations", auth: conversations.route.auth, handle: (input: Input) => conversations.route.handle(input) },
    {
      method: "PUT",
      path: "/v2/provider-instances",
      auth: "engine",
      handle(input: Input) {
        const id = input.body.id;
        if (typeof id !== "string" || !id) throw new HttpError(400, "invalid_request", "instance id is required");
        const saved = target(routes, "PUT", `/v2/provider-instances/${encodeURIComponent(id)}`);
        return saved.route.handle({ ...input, params: saved.params });
      },
    },
  ];
}
