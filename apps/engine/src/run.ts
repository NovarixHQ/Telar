import { startEngine, type EngineDaemon } from "./daemon";
import { hydrateHostPath } from "./platform/process/host-path";
import { providerSkillRoots } from "./domains/providers";
import { EngineStateError } from "./platform/kernel";
import { engineRootFromEnv } from "./platform/fs/engine-root";
import { ENGINE_EXIT_LOCK_HELD } from "./platform/process/daemon-lock";
import { installLastResortHandlers } from "./platform/process/last-resort";
import { statePaths } from "./platform/fs/state-paths";

export type RunEngineOptions = {
  network?: { host: string; port?: number };
  /** Runs once when the engine is asked to stop, before it closes. */
  onStop?: () => void | Promise<void>;
};

const STOP_DEADLINE_MS = 3_000;

/** The process entry: a working engine (embedded worker included) that stops cleanly on SIGINT, SIGTERM or a closed IPC channel. */
export async function runEngine(options: RunEngineOptions = {}): Promise<EngineDaemon> {
  // Before anything resolves a provider binary: a GUI-launched process has a minimal PATH.
  hydrateHostPath();
  const embeddedWorker = process.env.TELAR_EMBEDDED_WORKER?.trim() !== "0";
  let daemon: EngineDaemon;
  try {
    daemon = await startEngine({ embeddedWorker, ...(options.network ? { network: options.network } : {}), warmUsageCacheAfterMs: 5_000, skillRoots: providerSkillRoots() });
  } catch (error) {
    // A live lock means the store has an owner; it is not a crash, and gets its own exit code.
    if (!(error instanceof EngineStateError) || error.code !== "conflict") throw error;
    process.stderr.write(`Telar engine: ${error.message} — ${statePaths(engineRootFromEnv()).lock}\n`);
    process.exit(ENGINE_EXIT_LOCK_HELD);
  }
  installLastResortHandlers();
  process.stdout.write(
    `Telar engine listening on ${daemon.discovery.host}:${daemon.discovery.port}` +
      `${daemon.network ? `, paired devices on ${daemon.network.host}:${daemon.network.port}` : ""}` +
      `${daemon.worker ? ` with embedded worker ${daemon.worker.workerId}` : " (no embedded worker)"}\n`,
  );

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      setTimeout(() => process.exit(0), STOP_DEADLINE_MS).unref();
      await Promise.resolve(options.onStop?.()).catch(() => undefined);
      await daemon.close().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("disconnect", stop);
  return daemon;
}
