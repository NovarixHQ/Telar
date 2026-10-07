import type { DriverCapabilities } from "../src/drivers/capabilities";

export const STUB_CAPABILITIES: DriverCapabilities = {
  liveSteering: false,
  compaction: "none",
  backgroundTaskStop: false,
  contextInjection: "inline",
  fork: false,
  usageLimits: false,
};
