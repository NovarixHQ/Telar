import type { DeviceIdentity, DeviceRole, DeviceScope, ExposureMode, RemoteState } from "@telar/engine-client";
import { request } from "@/platform/engine/transport";
import type { QrMatrix } from "./qr";
import type { TailscaleServeError } from "./tailscale-serve";

/** The engine's answer plus what only this cockpit knows: its own host row, the caller, and where it listens. */
export type RemoteStatus = RemoteState & {
  tailscaleServeError?: TailscaleServeError;
  host?: { name: string; identity?: DeviceIdentity; isCaller?: boolean };
  callerDeviceId?: string;
  callerRole?: DeviceRole;
  callerScopes?: DeviceScope[];
  endpoints: Array<{ kind: string; label: string; url: string; qrSafe: boolean }>;
};

export type MintedPairing = { code: string; expiresAt: number; qrByUrl: Record<string, QrMatrix> };

const device = (deviceId: string) => `/v2/remote/devices/${encodeURIComponent(deviceId)}`;

export const remoteStatus = () => request<RemoteStatus>(fetch, "GET", "/v2/remote");

export const setRemote = (patch: { requireAuth: boolean } | { exposure: ExposureMode } | { tailscaleServe: boolean }) =>
  request<Record<string, unknown>>(fetch, "PATCH", "/v2/remote", patch);

export const mintPairing = () => request<MintedPairing>(fetch, "POST", "/v2/remote/pairing");

export const updateDevice = (deviceId: string, patch: { name?: string; scopes?: DeviceScope[] }) => request<unknown>(fetch, "PATCH", device(deviceId), patch);

export const revokeDevice = (deviceId: string) => request<unknown>(fetch, "DELETE", device(deviceId));

export const revokeOtherDevices = () => request<unknown>(fetch, "DELETE", "/v2/remote/devices");
