import os from "node:os";
import QRCode from "qrcode";
import type { EngineClient } from "@telar/engine-client";
import { connect, readServeInfo } from "./link";
import { UsageError, type Io } from "./io";
import { tailscaleStatus } from "./tailscale";

type Device = { id: string; name: string };
type RemoteState = { devices: Device[]; pairing?: { expiresAt: number } };

export type PairOptions = { home: string; tailscale: boolean; name?: string; pollMs?: number; signal?: AbortSignal };

function lanAddress(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) if (entry.family === "IPv4" && !entry.internal) return entry.address;
  }
  return undefined;
}

async function baseUrl(options: PairOptions): Promise<string> {
  if (options.tailscale) {
    const status = await tailscaleStatus();
    if (status.state !== "running") throw new UsageError("Tailscale is not running on this machine.");
    return `https://${status.dnsName}`;
  }
  const info = readServeInfo(options.home);
  if (!info) throw new UsageError("This engine has no network address. Start it with `telar serve`.");
  if (info.tailscale && info.host === "127.0.0.1") return `https://${info.tailscale}`;
  const wildcard = info.host === "0.0.0.0" || info.host === "::";
  return `http://${wildcard ? (lanAddress() ?? "127.0.0.1") : info.host}:${info.port}`;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

async function newDevice(client: EngineClient, known: Set<string>, options: PairOptions, expiresAt: number): Promise<Device | "expired" | "cancelled"> {
  for (;;) {
    if (options.signal?.aborted) return "cancelled";
    const state = await client.request<RemoteState>("GET", "/v2/remote");
    const device = state.devices.find((candidate) => !known.has(candidate.id));
    if (device) return device;
    if (!state.pairing || Date.now() >= expiresAt) return "expired";
    await sleep(options.pollMs ?? 1_000, options.signal);
  }
}

/** Mints a one-time pairing, prints how to use it, and waits for the device. Resolves to an exit code. */
export async function pair(options: PairOptions, io: Io): Promise<number> {
  const client = await connect(options.home);
  const base = await baseUrl(options);
  const known = new Set((await client.request<RemoteState>("GET", "/v2/remote")).devices.map((device) => device.id));
  const { code, expiresAt } = await client.request<{ code: string; expiresAt: number }>("POST", "/v2/remote/pairing", {});
  const link = `${base}/pair#token=${code}`;
  io.out(await QRCode.toString(link, { type: "terminal", small: true }));
  io.out(`Link: ${link}`);
  io.out(`Code: ${code.slice(0, 4)} ${code.slice(4)}`);
  io.out(`Valid for ${Math.round((expiresAt - Date.now()) / 60_000)} minutes. Waiting for a device…`);

  const device = await newDevice(client, known, options, expiresAt);
  if (device === "cancelled") {
    await client.request("DELETE", "/v2/remote/pairing").catch(() => undefined);
    return 130;
  }
  if (device === "expired") {
    io.err("The pairing expired before a device used it.");
    return 1;
  }
  if (options.name) await client.request("PATCH", `/v2/remote/devices/${device.id}`, { name: options.name });
  io.out(`Paired ${options.name ?? device.name}.`);
  return 0;
}
