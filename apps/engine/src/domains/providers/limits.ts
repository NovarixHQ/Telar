import type { ProviderInstance, UsageLimitWindow } from "@telar/engine-client";
import { CodexAppServer, readCodexLimits, resolveCodexBinary } from "../../drivers/codex";
import { providerProcessEnv } from "./instances";

export async function readProviderLimits(instance: ProviderInstance): Promise<UsageLimitWindow[]> {
  const client = new CodexAppServer(resolveCodexBinary(instance.binaryPath), { ...process.env, ...providerProcessEnv(instance) });
  try {
    return await readCodexLimits(client);
  } finally {
    client.kill();
  }
}
