import type http from "node:http";
import { MACHINE_NAMES } from "../../platform/http/host";
import { HttpError } from "../../platform/http/http";
import type { Route } from "../../platform/http/route";
import { decideAccess, deviceForBearer, isHostCaller, type TicketCheck } from "./auth";
import { setCaller } from "./caller";
import { roleOf } from "./scopes";
import { cookieRequestIsSameOrigin, readDeviceCookie } from "./cookie";
import type { Presence } from "./presence";
import type { RemoteStore } from "./store";

const OPEN = new Set(["GET /v2/ping", "GET /v2/identity", "POST /v2/remote/pair", "POST /v2/pair"]);

function networkAuthorize(store: RemoteStore, presence: Presence, checkTicket: TicketCheck) {
  return (auth: Route["auth"], request: http.IncomingMessage): void => {
    const method = (request.method ?? "GET").toUpperCase();
    const { pathname, searchParams } = new URL(request.url ?? "/", "http://engine");
    if (OPEN.has(`${method} ${pathname}`)) return;
    if (auth === "device") {
      if (!deviceForBearer(store, request.headers.authorization)) throw new HttpError(401, "engine_unauthorized", "pair this device to use the engine");
      return;
    }
    if (auth !== "engine") throw new HttpError(401, "engine_unauthorized", "this endpoint is not served on the network");
    const file = { ...store.read(), requireAuth: true };
    const deviceCookie = request.headers.authorization ? null : readDeviceCookie(request);
    if (deviceCookie && !cookieRequestIsSameOrigin(request)) throw new HttpError(403, "engine_unauthorized", "a browser session may write only from this host's own pages");
    const credentials = { authorization: request.headers.authorization ?? null, deviceCookie, hostHeader: String(request.headers["x-telar-host"] ?? "") || null };
    const hostSecret = process.env.TELAR_HOST_TOKEN;
    const decision = decideAccess(file, { pathname, method, ...credentials, ticket: searchParams.get("ticket") }, hostSecret, checkTicket);
    if (!decision.allow) {
      if (decision.code === "cockpit_forbidden") throw new HttpError(403, "engine_unauthorized", "this device's access does not cover this request");
      throw new HttpError(401, "engine_unauthorized", "pair this device to use the engine");
    }
    setCaller(request, { host: isHostCaller(credentials, hostSecret), ...(decision.deviceId && decision.scopes ? { device: { id: decision.deviceId, scopes: decision.scopes, role: roleOf(decision.scopes) } } : {}) });
    if (decision.deviceId) {
      presence.seen(decision.deviceId);
      store.touchDevice(decision.deviceId);
    }
  };
}

export function networkRouting(store: RemoteStore, presence: Presence, host: string, errorFor: (error: unknown) => HttpError, observe: <T>(operation: string, section: () => T) => T, checkTicket: TicketCheck) {
  return { authorize: networkAuthorize(store, presence, checkTicket), errorFor, observe, hostNames: new Set([...MACHINE_NAMES, host.toLowerCase()]) };
}
