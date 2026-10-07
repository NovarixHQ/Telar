import type { ProviderInstance, UsageLimitWindow } from "@telar/engine-client";
import { CodexAppServer, readCodexLimits, resolveCodexBinary } from "../../drivers/codex";
import { providerProcessEnv } from "./instances";

/** Asks a Codex login's own app-server for its plan windows; the process lives only for the read. */
export async function readProviderLimits(instance: ProviderInstance): Promise<UsageLimitWindow[]> {
  const client = new CodexAppServer(resolveCodexBinary(instance.binaryPath), { ...process.env, ...providerProcessEnv(instance) });
  try {
    return await readCodexLimits(client);
  } finally {
    client.kill();
  }
}
