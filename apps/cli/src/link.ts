import fs from "node:fs";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { discoverEngine } from "@telar/engine-client/node";
import { engineRootFor } from "@telar/engine/headless";
import { UsageError } from "./io";

export const DEFAULT_PORT = 7420;

export type ServeInfo = { host: string; port: number; tailscale?: string };

const serveFile = (home: string): string => path.join(engineRootFor(home), "serve.json");

export function writeServeInfo(home: string, info: ServeInfo): void {
  fs.writeFileSync(serveFile(home), JSON.stringify(info), { mode: 0o600 });
}

export function removeServeInfo(home: string): void {
  fs.rmSync(serveFile(home), { force: true });
}

export function readServeInfo(home: string): ServeInfo | undefined {
  try {
    return JSON.parse(fs.readFileSync(serveFile(home), "utf8")) as ServeInfo;
  } catch {
    return undefined;
  }
}

/** The running engine's loopback client; the token it carries never leaves this process. */
export async function connect(home: string): Promise<EngineClient> {
  try {
    const client = new EngineClient(await discoverEngine(engineRootFor(home)));
    await client.request("GET", "/v2/ping");
    return client;
  } catch {
    throw new UsageError("No engine is running here. Start one with `telar serve`.");
  }
}
