import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const BINARIES = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

export type TailscaleStatus = { state: "missing" } | { state: "stopped"; backend: string } | { state: "running"; dnsName: string };

async function tailscale(args: string[]): Promise<string> {
  let last: unknown;
  for (const bin of BINARIES) {
    try {
      return (await run(bin, args, { timeout: 5_000 })).stdout;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      last = error;
    }
  }
  throw last;
}

export async function tailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const status = JSON.parse(await tailscale(["status", "--json"])) as { BackendState?: string; Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.replace(/\.$/, "");
    if (status.BackendState === "Running" && dnsName) return { state: "running", dnsName };
    return { state: "stopped", backend: status.BackendState ?? "unknown" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    return { state: "stopped", backend: "unreachable" };
  }
}

export async function serveOn(port: number): Promise<void> {
  await tailscale(["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]);
}

export async function serveOff(): Promise<void> {
  await tailscale(["serve", "--https=443", "off"]);
}
