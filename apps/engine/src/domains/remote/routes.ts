import { thisComputerName } from "../../platform/http/host";
import pkg from "../../../package.json" with { type: "json" };
import type { DeviceIdentity, DevicePlatform, PairingRefusal, RemoteDevice, RemoteState } from "@telar/engine-client";
import { mintDeviceToken, RemoteStoreError, type PairedDevice, type RemoteStore } from "./store";
import { fail, ok, type Route } from "../../platform/http/route";
import { authRoutes, type TicketCheck } from "./auth";
import { deviceCookieHeader } from "./cookie";
import { createPresence, type Presence } from "./presence";
import { ALL_SCOPES, normaliseScopes, roleOf, scopesForRole } from "./scopes";
import { callerOf } from "./caller";
import { readServeError } from "./serve-error";
import { dialableAddresses, type CockpitEndpoint } from "./endpoints";
import { describeDevice, observeIdentity } from "./observe";

type Body = Record<string, unknown>;

const SESSION_MAX_MS = 365 * 24 * 60 * 60 * 1000;

const REFUSAL: Record<PairingRefusal, string> = {
  "none-pending": "No pairing code is waiting. Generate one in Settings → Remote access — a code is single-use, so one that already paired a device is spent.",
  expired: "That pairing code has expired. They last five minutes; generate a fresh one.",
  mismatch: "That is not the pending pairing code. Check the digits — or, if you have more than one Telar running, generate the code from the same one you are pairing against.",
  burned: "Too many wrong tries; that pairing code has been destroyed. Generate a fresh one in Settings → Remote access.",
};

const text = (value: unknown, limit = 64): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : undefined;

function identityOf(value: unknown): DeviceIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const identity: DeviceIdentity = { kind: text(raw.kind) ?? "unknown" };
  for (const key of ["client", "machine", "os", "address", "origin"] as const) {
    const field = text(raw[key], 256);
    if (field) identity[key] = field;
  }
  return identity;
}

const publicDevice = ({ id, name, createdAt, lastSeenAt, expiresAt, scopes, platform, identity }: PairedDevice): RemoteDevice => ({
  id,
  name,
  createdAt,
  lastSeenAt,
  expiresAt,
  scopes,
  role: roleOf(scopes),
  platform,
  identity,
});

const OS_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

function hostRow(isCaller: boolean) {
  if (!process.env.TELAR_HOST_TOKEN) return undefined;
  const machine = thisComputerName();
  const identity: DeviceIdentity = {
    kind: "desktop",
    client: process.env.TELAR_HOST_CLIENT?.trim() || "Telar",
    ...(machine ? { machine } : {}),
    ...(OS_NAMES[process.platform] ? { os: OS_NAMES[process.platform] } : {}),
  };
  return { name: describeDevice(identity), identity, isCaller };
}

function pairDevice(store: RemoteStore, input: { code: string; name: string | undefined; identity: DeviceIdentity | undefined; clientId: string | undefined; platform: DevicePlatform | undefined }) {
  const grant = store.pendingGrant();
  const outcome = input.code ? store.consumePairing(input.code) : "none-pending";
  if (outcome !== true) return { refused: { status: 401, body: { error: { code: "cockpit_unauthorized", reason: outcome, message: REFUSAL[outcome] } } } };
  const deviceToken = mintDeviceToken();
  const device = store.addDevice(input.name ?? "Unnamed device", deviceToken, {
    ...(grant ? { scopes: grant.scopes } : {}),
    ...(grant?.sessionMs ? { expiresAt: Date.now() + grant.sessionMs } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.identity ? { identity: input.identity } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
  });
  return { deviceToken, device };
}

function statusRoute(store: RemoteStore, presence: Presence, endpoints: () => CockpitEndpoint[]): Route {
  return {
    method: "GET",
    path: "/v2/remote",
    auth: "engine",
    handle({ request }) {
      const file = store.read();
      const caller = callerOf(request);
      const state: RemoteState = {
        requireAuth: file.requireAuth,
        exposure: file.exposure ?? "local-only",
        tailscaleServe: file.tailscaleServe === true,
        devices: file.devices.map((device) => ({ ...publicDevice(device), ...presence.of(device.id, device.lastSeenAt) })),
        ...(file.pairing ? { pairing: { expiresAt: file.pairing.expiresAt } } : {}),
      };
      return ok({
        ...state,
        host: hostRow(caller.host),
        tailscaleServeError: readServeError(),
        callerDeviceId: caller.device?.id,
        callerRole: caller.device?.role,
        callerScopes: caller.device?.scopes,
        endpoints: endpoints(),
      });
    },
  };
}

export function remoteRoutes(store: RemoteStore, checkTicket?: TicketCheck, presence: Presence = createPresence(), endpoints: () => CockpitEndpoint[] = () => []): Route[] {
  const routes: Route[] = [
    {
      method: "GET",
      path: "/v2/ping",
      auth: "engine",
      handle: () => ok({ ok: true, proto: 1, appVersion: pkg.version }),
    },
    statusRoute(store, presence, endpoints),
    {
      method: "PATCH",
      path: "/v2/remote",
      auth: "engine",
      handle({ body, request }) {
        if (body.tailscaleServe !== undefined) {
          if (typeof body.tailscaleServe !== "boolean") return fail(400, "invalid_request", "tailscaleServe must be a boolean.");
          return ok({ tailscaleServe: store.setTailscaleServe(body.tailscaleServe).tailscaleServe === true, restartRequired: true });
        }
        if (body.exposure !== undefined) {
          if (body.exposure !== "local-only" && body.exposure !== "network-accessible") {
            return fail(400, "invalid_request", "exposure must be local-only or network-accessible.");
          }
          return ok({ exposure: store.setExposure(body.exposure).exposure, restartRequired: true });
        }
        if (typeof body.requireAuth !== "boolean") return fail(400, "invalid_request", "requireAuth must be a boolean.");
        if (!body.requireAuth) {
          store.setRequireAuth(false);
          return ok({ requireAuth: false });
        }
        store.setRequireAuth(true);
        const pairsCaller = !body.device && !callerOf(request).host;
        const identity = pairsCaller ? observeIdentity(request) : identityOf((body.device as Body | undefined)?.identity);
        if (!pairsCaller && (!body.device || typeof body.device !== "object")) return ok({ requireAuth: true });
        const deviceToken = mintDeviceToken();
        const name = pairsCaller ? describeDevice(identity!) : text((body.device as Body).name);
        const device = store.addDevice(name ?? "Unnamed device", deviceToken, identity ? { identity } : {});
        const answer = { requireAuth: true, device: { id: device.id, name: device.name } };
        if (!pairsCaller) return ok({ ...answer, deviceToken });
        return { status: 200, body: answer, headers: { "set-cookie": deviceCookieHeader(deviceToken, request), "cache-control": "no-store" } };
      },
    },
    {
      method: "POST",
      path: "/v2/remote/pairing",
      auth: "engine",
      handle({ body }) {
        const scopes = body.scopes === undefined ? ALL_SCOPES : normaliseScopes(body.scopes);
        if (!scopes) return fail(400, "invalid_request", "scopes must be a non-empty list from read|write|admin.");
        const sessionMs = body.expiresInMs;
        if (sessionMs !== undefined && !(typeof sessionMs === "number" && Number.isInteger(sessionMs) && sessionMs > 0 && sessionMs <= SESSION_MAX_MS)) {
          return fail(400, "invalid_request", "expiresInMs must be a whole number of milliseconds, at most a year.");
        }
        const chosen = body.scopes !== undefined || sessionMs !== undefined;
        return ok({ ...store.mintPairing(Date.now(), undefined, chosen ? { scopes, ...(sessionMs ? { sessionMs } : {}) } : undefined), scopes });
      },
    },
    {
      method: "DELETE",
      path: "/v2/remote/pairing",
      auth: "engine",
      handle() {
        store.clearPairing();
        return ok({ ok: true });
      },
    },
    {
      method: "POST",
      path: "/v2/remote/pair",
      auth: "engine",
      handle({ body, request }) {
        const platform: DevicePlatform | undefined = body.platform === "ios" || body.platform === "browser" ? body.platform : undefined;
        const paired = pairDevice(store, { code: typeof body.code === "string" ? body.code : "", name: text(body.name), identity: identityOf(body.identity), clientId: text(body.clientId, 128), platform });
        if ("refused" in paired) return paired.refused;
        const answer = ok({ deviceToken: paired.deviceToken, deviceId: paired.device.id, deviceName: paired.device.name });
        return platform === "browser" ? { ...answer, headers: { "set-cookie": deviceCookieHeader(paired.deviceToken, request) } } : answer;
      },
    },
    {
      method: "POST",
      path: "/v2/pair",
      auth: "engine",
      handle({ body, request }) {
        const platform: DevicePlatform | undefined = body.platform === "ios" || body.platform === "browser" ? body.platform : undefined;
        const identity = observeIdentity(request, { kind: body.kind ?? (platform === "ios" ? "phone" : undefined), client: body.client, machine: body.machine, os: body.os });
        const paired = pairDevice(store, { code: typeof body.token === "string" ? body.token : "", name: describeDevice(identity, typeof body.deviceName === "string" ? body.deviceName : undefined), identity, clientId: text(body.clientId, 128), platform });
        if ("refused" in paired) return paired.refused;
        return {
          status: 200,
          body: { deviceToken: paired.deviceToken, deviceId: paired.device.id, deviceName: paired.device.name, addresses: dialableAddresses(endpoints()) },
          headers: { "set-cookie": deviceCookieHeader(paired.deviceToken, request), "cache-control": "no-store" },
        };
      },
    },
    {
      method: "DELETE",
      path: "/v2/remote/devices",
      auth: "engine",
      handle({ query, request }) {
        return ok({ revoked: store.revokeOtherDevices(query.get("keep") ?? callerOf(request).device?.id) });
      },
    },
    {
      method: "PATCH",
      path: /^\/v2\/remote\/devices\/([^/]+)$/,
      auth: "engine",
      handle({ body, params: [id] }) {
        const name = typeof body.name === "string" ? body.name : undefined;
        const scopes = body.scopes !== undefined ? normaliseScopes(body.scopes) : body.role === "full" || body.role === "observer" ? scopesForRole(body.role) : undefined;
        if (name === undefined && scopes === undefined) return fail(400, "invalid_request", "Provide a name and/or scopes from read|write|admin.");
        let device: PairedDevice | undefined;
        if (name !== undefined) device = store.renameDevice(id!, name);
        if (scopes !== undefined) {
          try {
            device = store.setDeviceScopes(id!, scopes);
          } catch (error) {
            if (error instanceof RemoteStoreError) return fail(409, "cockpit_last_admin_device", error.message);
            throw error;
          }
        }
        if (!device) return fail(404, "not_found", "No such device.");
        const { identity: _identity, ...visible } = publicDevice(device);
        return ok({ device: visible });
      },
    },
    {
      method: "DELETE",
      path: /^\/v2\/remote\/devices\/([^/]+)$/,
      auth: "engine",
      handle: ({ params: [id] }) => (store.revokeDevice(id!) ? ok({ ok: true }) : fail(404, "not_found", "No such device.")),
    },
  ];
  return [...routes, ...authRoutes(store, presence, checkTicket)].map((route) => ({ ...route, handle: (input) => refusalsAsBadRequest(() => route.handle(input)) }));
}

function refusalsAsBadRequest(run: () => ReturnType<Route["handle"]>): ReturnType<Route["handle"]> {
  try {
    return run();
  } catch (error) {
    if (error instanceof RemoteStoreError) return fail(400, "invalid_request", error.message);
    throw error;
  }
}
