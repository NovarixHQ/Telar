import { ENGINE_PROTO, type DeviceScope } from "@telar/engine-client";

/** A host that does not answer `/v2/ping` is older than proto 2 and is reached through the `/api` alias. */
export async function hostProto(address: string, fetch: typeof globalThis.fetch, signal?: AbortSignal): Promise<number> {
  const answer = (await fetch(`${address}/v2/ping`, { signal }).then((response) => response.json(), () => null)) as { ok?: unknown; proto?: unknown } | null;
  return answer?.ok === true && typeof answer.proto === "number" ? answer.proto : 1;
}

export const speaksV2 = (proto: number) => proto >= ENGINE_PROTO;

export const apiRoot = (address: string, proto: number) => `${address}${speaksV2(proto) ? "/v2" : "/api"}`;

/** `undefined` when the host did not say who is asking: the engine then decides each request. */
export const canWrite = (scopes: readonly DeviceScope[] | undefined) => scopes === undefined || scopes.includes("write");

export const canAdmin = (scopes: readonly DeviceScope[] | undefined) => scopes === undefined || scopes.includes("admin");
