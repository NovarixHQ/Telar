import type http from "node:http";
import { MACHINE_NAMES } from "../../platform/http/host";
import { HttpError } from "../../platform/http/http";
import type { Route } from "../../platform/http/route";
import { decideAccess, deviceForBearer } from "./auth";
import type { Presence } from "./presence";
import type { RemoteStore } from "./store";

const OPEN = new Set(["GET /v2/ping", "POST /v2/remote/pair"]);
const ENGINE_ONLY = new Set(["/v2/auth/decide", "/v2/auth/identify"]);

function networkAuthorize(store: RemoteStore, presence: Presence) {
  return (auth: Route["auth"], request: http.IncomingMessage): void => {
    const method = (request.method ?? "GET").toUpperCase();
    const pathname = new URL(request.url ?? "/", "http://engine").pathname;
    if (OPEN.has(`${method} ${pathname}`)) return;
    if (auth === "device") {
      if (!deviceForBearer(store, request.headers.authorization)) throw new HttpError(401, "engine_unauthorized", "pair this device to use the engine");
      return;
    }
    if (auth !== "engine" || ENGINE_ONLY.has(pathname)) throw new HttpError(401, "engine_unauthorized", "this endpoint is not served on the network");
    const file = { ...store.read(), requireAuth: true };
    const decision = decideAccess(file, { pathname, method, authorization: request.headers.authorization ?? null }, undefined);
    if (!decision.allow) {
      if (decision.code === "cockpit_forbidden") throw new HttpError(403, "engine_unauthorized", "this device is paired for viewing only");
      throw new HttpError(401, "engine_unauthorized", "pair this device to use the engine");
    }
    if (decision.deviceId) {
      presence.seen(decision.deviceId);
      store.touchDevice(decision.deviceId);
    }
  };
}

export function networkRouting(store: RemoteStore, presence: Presence, host: string, errorFor: (error: unknown) => HttpError, observe: <T>(operation: string, section: () => T) => T) {
  return { authorize: networkAuthorize(store, presence), errorFor, observe, hostNames: new Set([...MACHINE_NAMES, host.toLowerCase()]) };
}
