export type DriverCapabilities = {
  liveSteering: boolean;
  compaction: "native" | "text" | "none";
  backgroundTaskStop: boolean;
  contextInjection: "native" | "inline";
  fork: boolean;
  usageLimits: boolean;
};

export const CLAUDE_CAPABILITIES: DriverCapabilities = {
  liveSteering: true,
  compaction: "native",
  backgroundTaskStop: true,
  contextInjection: "inline",
  fork: true,
  usageLimits: true,
};

export const CODEX_CAPABILITIES: DriverCapabilities = {
  liveSteering: true,
  compaction: "native",
  backgroundTaskStop: false,
  contextInjection: "native",
  fork: false,
  usageLimits: true,
};

export const OPENCODE_CAPABILITIES: DriverCapabilities = {
  liveSteering: false,
  compaction: "none",
  backgroundTaskStop: false,
  contextInjection: "inline",
  fork: false,
  usageLimits: false,
};

const NO_CAPABILITIES: DriverCapabilities = {
  liveSteering: false,
  compaction: "none",
  backgroundTaskStop: false,
  contextInjection: "inline",
  fork: false,
  usageLimits: false,
};

const BY_DRIVER: Record<string, DriverCapabilities> = { claude: CLAUDE_CAPABILITIES, codex: CODEX_CAPABILITIES, opencode: OPENCODE_CAPABILITIES };

/** For the engine, which never loads the drivers themselves. */
export const driverCapabilities = (driver: string): DriverCapabilities => BY_DRIVER[driver] ?? NO_CAPABILITIES;
