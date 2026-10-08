import { EngineHealth, HostIdentity } from "@telar/engine-client";
import type { SymbolName } from "../../ui";

export type Banner = { icon: SymbolName; tone: "emerald" | "amber" | "red"; title: string; detail?: string };

export type ProbeResult =
  | { kind: "ok"; daemonId: string; workerRegistered: boolean; identity?: HostIdentity }
  | { kind: "unpaired" }
  | { kind: "failed"; message: string };

const NO_ANSWER = "No answer. Is the cockpit running and bound to the tailnet IP (TELAR_WEB_HOST)? Is this phone on the tailnet?";

const parse = (address: string | undefined): URL | undefined => {
  if (!address) return undefined;
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
};

/** The cockpit's base URL from the Host and Port fields; a full URL in Host wins. */
export function cockpitAddress(host: string, port: string): string {
  const trimmed = host.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return `http://${trimmed}:${port.trim() || "3000"}`;
}

/** The Host and Port fields for a known address. */
export function addressFields(address: string | undefined): { host: string; port: string } {
  const url = parse(address);
  return url ? { host: url.hostname, port: url.port || (url.protocol === "https:" ? "443" : "3000") } : { host: "", port: "3000" };
}

async function body(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Asks the cockpit for the engine's health with this phone's credential, telling a locked cockpit from a silent one. */
export async function testConnection(address: string, token: string | undefined, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<ProbeResult> {
  if (!parse(address)) return { kind: "failed", message: "That doesn't look like a host." };
  let response: Response;
  try {
    response = await fetch(`${address}/api/health`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  } catch {
    return { kind: "failed", message: NO_ANSWER };
  }
  const answer = await body(response);
  if (response.status === 401) {
    const pong = await fetch(`${address}/api/ping`).then(body, () => null);
    return (pong as { ok?: unknown } | null)?.ok === true ? { kind: "unpaired" } : { kind: "failed", message: "No answer. Is this phone on the tailnet?" };
  }
  const error = (answer as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (error?.code === "engine_unavailable") return { kind: "failed", message: "Cockpit answered, but the engine on the computer is down." };
  const health = EngineHealth.pick({ daemonId: true, worker: true }).safeParse(answer);
  if (!response.ok || !health.success) return { kind: "failed", message: typeof error?.message === "string" ? error.message : "Failed." };
  const identity = HostIdentity.safeParse(await fetch(`${address}/api/identity`).then(body, () => null));
  return {
    kind: "ok",
    daemonId: health.data.daemonId,
    workerRegistered: health.data.worker.registered,
    ...(identity.success ? { identity: identity.data } : {}),
  };
}

/** What the result card under Test connection says. */
export function probeBanner(result: ProbeResult): Banner {
  switch (result.kind) {
    case "ok":
      return {
        icon: "checkmark.circle.fill",
        tone: "emerald",
        title: `Connected — engine ${result.daemonId.slice(0, 14)}…`,
        ...(result.workerRegistered ? {} : { detail: "No worker registered: turns will queue but not run." }),
      };
    case "unpaired":
      return { icon: "lock.circle", tone: "amber", title: "Reachable, but this cockpit requires pairing.", detail: "Scan or paste a pairing link above." };
    case "failed":
      return { icon: "xmark.circle", tone: "red", title: result.message };
  }
}

export const pairedBanner = (name: string): Banner => ({
  icon: "checkmark.seal.fill",
  tone: "emerald",
  title: `This phone is paired with ${name}.`,
  detail: "Pasting a new link replaces the credential.",
});

/** The Connections row under a computer's name, as Swift words it. */
export function connectionsSubtitle(token: string, address: string | undefined): string {
  return `${token ? "Paired" : "Open"} · ${parse(address)?.hostname ?? address ?? ""}`;
}

/** The Connection row in a computer's settings: where it is and whether this phone holds a credential. */
export function connectionRowSubtitle(token: string, address: string | undefined): string {
  const url = parse(address);
  const where = url ? (url.port ? `${url.hostname}:${url.port}` : url.hostname) : address;
  return [where, token ? "paired" : "open"].filter(Boolean).join(" · ");
}
