import path from "node:path";
import type { EngineClient, SimulatorSummary, WorkerClaim } from "@telar/engine-client";
import type { SimulatorCapability } from "./tools";

type SimulatorClient = Pick<EngineClient, "simulators" | "bootSimulator" | "shutdownSimulator" | "simulatorScreenshot">;
type Shown = { kind: "simulator.opened"; simulator: SimulatorSummary } | { kind: "simulator.closed"; simulatorId: string };

export function clientSimulatorCapability(client: SimulatorClient, report: (observation: Shown) => Promise<unknown>, binDir: string | undefined): SimulatorCapability {
  return {
    agentDevice: binDir ? path.join(binDir, "agent-device") : undefined,
    list: async () => (await client.simulators()).simulators,
    async open(id) {
      const known = (await client.simulators()).simulators.simulators.find((simulator) => simulator.id === id);
      const simulator = known?.booted ? known : (await client.bootSimulator(id)).simulator;
      await report({ kind: "simulator.opened", simulator }).catch(() => undefined);
      return simulator;
    },
    async screenshot(id) {
      const { data, contentType } = await client.simulatorScreenshot(id);
      return { data, mediaType: contentType };
    },
    async close(id, shutdown) {
      if (shutdown) await client.shutdownSimulator(id);
      await report({ kind: "simulator.closed", simulatorId: id }).catch(() => undefined);
    },
  };
}

export function withSimulatorTools(env: Record<string, string | undefined> | undefined, access: WorkerClaim["simulators"]): Record<string, string | undefined> | undefined {
  const { binDir, developerDir } = access ?? {};
  if (!binDir && !developerDir) return env;
  const inherited = env?.PATH ?? process.env.PATH;
  return {
    ...env,
    ...(binDir ? { PATH: inherited ? `${binDir}${path.delimiter}${inherited}` : binDir } : {}),
    ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}),
  };
}
