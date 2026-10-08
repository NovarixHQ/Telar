import type { Wakeup } from "./host-connection";

const LONG_BACKGROUND_MS = 10_000;

/** After a long spell in the background the old link is presumed dead; after a short one it is only checked. */
export function foregroundWakeup(backgroundMs: number): Wakeup {
  return backgroundMs >= LONG_BACKGROUND_MS ? "reconnect" : "probe";
}
