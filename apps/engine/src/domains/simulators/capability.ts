import path from "node:path";
import type { EngineClient, SimulatorSummary } from "@telar/engine-client";
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

export function withAgentDevice(env: Record<string, string | undefined> | undefined, binDir: string | undefined): Record<string, string | undefined> | undefined {
  if (!binDir) return env;
  const inherited = env?.PATH ?? process.env.PATH;
  return { ...env, PATH: inherited ? `${binDir}${path.delimiter}${inherited}` : binDir };
}
