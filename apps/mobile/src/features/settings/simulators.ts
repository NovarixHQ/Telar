import type { SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import type { ThemeColor } from "../../ui";

export type SimulatorBanner = { icon: "iphone.slash" | "hourglass" | "xmark.circle" | "iphone" | "exclamationmark.triangle"; tint: ThemeColor; title: string; detail?: string };

export function simulatorBanner(state: SimulatorsState): SimulatorBanner | undefined {
  const detail = state.detail ? { detail: state.detail } : {};
  switch (state.status) {
    case "disabled":
      return { icon: "iphone.slash", tint: "textMuted", title: "Simulators are off on this computer.", detail: "Turn them on in the cockpit's settings on the computer." };
    case "installing":
    case "starting":
    case "idle":
      return { icon: "hourglass", tint: "textMuted", title: "Getting simulators ready…", ...detail };
    case "failed":
      return { icon: "xmark.circle", tint: "red", title: "Simulators could not start.", ...detail };
  }
  const problems = [...state.errors, ...state.platforms.flatMap((platform) => (!platform.available && platform.reason ? [platform.reason] : []))];
  if (state.simulators.length === 0) return { icon: "iphone", tint: "textMuted", title: "No simulators found.", ...(problems.length > 0 ? { detail: problems.join("\n") } : {}) };
  return problems.length > 0 ? { icon: "exclamationmark.triangle", tint: "amber", title: problems.join("\n") } : undefined;
}

/** Settling hubs are polled every 3 s, settled ones every 15 s. */
export function pollDelay(state: SimulatorsState | undefined): number {
  return state && (state.status === "installing" || state.status === "starting") ? 3000 : 15000;
}

export function simulatorSubtitle(simulator: SimulatorSummary): string {
  return [simulator.version, simulator.booted ? "Running" : undefined].filter(Boolean).join(" · ");
}

export function simulatorIcon(simulator: SimulatorSummary): "applewatch" | "iphone" {
  return simulator.pairedWith ? "applewatch" : "iphone";
}
