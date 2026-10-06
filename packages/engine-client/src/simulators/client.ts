import type { EngineTransport } from "../platform/transport";
import type { SimulatorSummary, SimulatorsState } from "./schema";

const simulatorPath = (id: string, verb: string) => `/v2/simulators/${encodeURIComponent(id)}/${verb}`;

export const simulatorsClient = {
  simulators(this: EngineTransport): Promise<{ simulators: SimulatorsState }> {
    return this.request("GET", "/v2/simulators");
  },

  bootSimulator(this: EngineTransport, id: string): Promise<{ simulator: SimulatorSummary }> {
    return this.request("POST", simulatorPath(id, "boot"), {});
  },

  shutdownSimulator(this: EngineTransport, id: string): Promise<{ simulator: SimulatorSummary }> {
    return this.request("POST", simulatorPath(id, "shutdown"), {});
  },
};
