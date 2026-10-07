import type { EngineTransport } from "../platform/transport";
import type { SimulatorAction, SimulatorChrome, SimulatorDetail, SimulatorInput, SimulatorStreamTicket, SimulatorSummary, SimulatorsState } from "./schema";

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

  simulatorScreenshot(this: EngineTransport, id: string): Promise<{ data: Uint8Array; contentType: string }> {
    return this.readBytes(simulatorPath(id, "screenshot"));
  },

  simulatorDetail(this: EngineTransport, id: string): Promise<{ detail: SimulatorDetail }> {
    return this.request("GET", simulatorPath(id, "detail"));
  },

  simulatorChrome(this: EngineTransport, id: string): Promise<{ chrome: SimulatorChrome | null }> {
    return this.request("GET", simulatorPath(id, "chrome"));
  },

  simulatorAction(this: EngineTransport, id: string, action: SimulatorAction): Promise<{ detail: SimulatorDetail }> {
    return this.request("POST", simulatorPath(id, "action"), action);
  },

  sendSimulatorInput(this: EngineTransport, id: string, events: SimulatorInput[]): Promise<{ sent: number }> {
    return this.request("POST", simulatorPath(id, "input"), { events });
  },

  simulatorStreamTicket(this: EngineTransport): Promise<SimulatorStreamTicket> {
    return this.request("GET", "/v2/simulators/stream-ticket");
  },
};
