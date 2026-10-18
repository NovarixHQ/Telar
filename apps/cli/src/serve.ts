import { runEngine } from "@telar/engine/headless";
import { DEFAULT_PORT, removeServeInfo, writeServeInfo } from "./link";
import { UsageError, type Io } from "./io";
import { serveOff, serveOn, tailscaleStatus } from "./tailscale";

export type ServeOptions = { home: string; host: string; port: number; tailscaleServe: boolean };

export function serveOptions(values: { host?: string; port?: string; "tailscale-serve"?: boolean }, home: string): ServeOptions {
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be a number from 0 to 65535.");
  return { home, host: values.host ?? "127.0.0.1", port, tailscaleServe: values["tailscale-serve"] === true };
}

/** Runs the engine in the foreground until SIGINT or SIGTERM. */
export async function serve(options: ServeOptions, io: Io): Promise<void> {
  process.env.TELAR_HOME = options.home;
  let exposed = false;
  const daemon = await runEngine({
    network: { host: options.host, port: options.port },
    onStop: async () => {
      removeServeInfo(options.home);
      if (exposed) await serveOff().catch(() => undefined);
    },
  });
  const network = daemon.network!;
  let dnsName: string | undefined;
  if (options.tailscaleServe) {
    const status = await tailscaleStatus();
    if (status.state !== "running") io.err("Tailscale is not running; skipping --tailscale-serve.");
    else {
      try {
        await serveOn(network.port);
        exposed = true;
        dnsName = status.dnsName;
      } catch {
        io.err("`tailscale serve` failed; the engine is reachable on its own address only.");
      }
    }
  }
  writeServeInfo(options.home, { host: network.host, port: network.port, ...(dnsName ? { tailscale: dnsName } : {}) });
  io.out(`Serving on http://${network.host}:${network.port}${dnsName ? ` and https://${dnsName}` : ""}`);
  io.out("Pair a device with `telar pair`.");
}
