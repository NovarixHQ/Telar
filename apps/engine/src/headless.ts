import { engineRootFromEnv } from "./platform/fs/engine-root";

export { runEngine, type RunEngineOptions } from "./run";
export { nodePtySpawner } from "./domains/terminal";
export { resolveCli, signInOf } from "./domains/providers";

/** The directory under `home` where a running engine publishes `engine.json`. */
export const engineRootFor = (home: string): string => engineRootFromEnv({ TELAR_HOME: home });
export { isMcpBridgeProcess, runMcpBridge } from "./drivers/acp/mcp-bridge";
export { APPARMOR_PROFILE_PATH, browserReadiness, defaultDownload, distroOf, runSetup, setupPlan, describeStep, type BrowserReadiness, type SetupStep } from "./domains/browser/setup";
export { runOnce } from "./domains/browser/transport";
export { resolvePlaywrightCoreCli } from "./domains/browser/transport";
export { runScriptFromEnv } from "./domains/browser/script";
