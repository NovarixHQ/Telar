import { createEngineApi } from "@/platform/engine";
import { hostFetcher, LOCAL_HOST_ID, rewriteApiPath } from "@/platform/engine/host-client";
import { openSimulators } from "./tabs";

type EngineApi = ReturnType<typeof createEngineApi>;

export type SimulatorsApi = Pick<
  EngineApi,
  "simulators" | "showSessionSimulator" | "bootSimulator" | "shutdownSimulator" | "simulatorScreenshot" | "simulatorDetail" | "simulatorChrome" | "simulatorAction" | "sendSimulatorInput" | "simulatorStreamTicket" | "setSimulatorSettings"
>;

export function createSimulatorsApi(hostId: string | undefined): SimulatorsApi {
  return createEngineApi(hostFetcher(hostId ?? LOCAL_HOST_ID));
}

export function releaseSimulatorTab(api: Pick<SimulatorsApi, "showSessionSimulator">, sessionId: string, params: Readonly<Record<string, string>> | undefined): void {
  for (const id of openSimulators(params)) void api.showSessionSimulator(sessionId, id, false).catch(() => undefined);
}

export function hubUrl(path: string, options: { hostId?: string | undefined; ticket?: string | undefined; query?: Record<string, string> } = {}): string {
  const search = new URLSearchParams(options.query);
  if (options.ticket) search.set("ticket", options.ticket);
  const pathname = rewriteApiPath(`/api/simulators/hub${path}`, options.hostId ?? LOCAL_HOST_ID);
  return search.size > 0 ? `${pathname}?${search}` : pathname;
}
