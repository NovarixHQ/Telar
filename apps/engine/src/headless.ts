import { engineRootFromEnv } from "./platform/fs/engine-root";

export { runEngine, type RunEngineOptions } from "./run";
export { nodePtySpawner } from "./domains/terminal";
export { resolveCli, signInOf } from "./domains/providers";

/** The directory under `home` where a running engine publishes `engine.json`. */
export const engineRootFor = (home: string): string => engineRootFromEnv({ TELAR_HOME: home });
export { isMcpBridgeProcess, runMcpBridge } from "./drivers/acp/mcp-bridge";
