import { HttpError } from "./http";
import type { Route } from "./route";
import { matchRoute } from "./router";

type Input = Parameters<Route["handle"]>[0];

function target(routes: readonly Route[], method: string, path: string): { route: Route; params: string[] } {
  const matched = matchRoute(routes, method, path);
  if (!matched) throw new Error(`legacy alias has no target: ${method} ${path}`);
  return matched;
}

/** The paths released iOS builds and older hosts still call. Remove on 2027-01-31. */
export function legacyRoutes(routes: readonly Route[]): Route[] {
  const listSessions = target(routes, "GET", "/v2/sessions");
  const createSession = target(routes, "POST", "/v2/sessions");
  const conversations = target(routes, "GET", "/v2/claude/conversations");
  const projectSessions = /^\/v2\/projects\/([^/]+)\/sessions$/;
  return [
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
