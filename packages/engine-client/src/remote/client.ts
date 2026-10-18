import type { EngineTransport } from "../platform/transport";
import type { DeviceScope, PairingMint, RemoteDevice, RemoteState } from "./schema";

const devicePath = (id: string) => `/v2/remote/devices/${encodeURIComponent(id)}`;

export const remoteClient = {
  remoteState(this: EngineTransport): Promise<RemoteState> {
    return this.request("GET", "/v2/remote");
  },

  mintPairing(this: EngineTransport, grant: { scopes?: DeviceScope[]; expiresInMs?: number } = {}): Promise<PairingMint> {
    return this.request("POST", "/v2/remote/pairing", grant);
  },

  setDeviceScopes(this: EngineTransport, id: string, scopes: DeviceScope[]): Promise<{ device: RemoteDevice }> {
    return this.request("PATCH", devicePath(id), { scopes });
  },

  revokeDevice(this: EngineTransport, id: string): Promise<{ ok: true }> {
    return this.request("DELETE", devicePath(id));
  },

  revokeOtherDevices(this: EngineTransport, keep?: string): Promise<{ revoked: number }> {
    return this.request("DELETE", `/v2/remote/devices${keep ? `?keep=${encodeURIComponent(keep)}` : ""}`);
  },
};
