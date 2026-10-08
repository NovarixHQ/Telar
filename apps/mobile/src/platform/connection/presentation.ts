import type { ConnectionState } from "./host-connection";

export type Presented = { label: string; tone: "ok" | "busy" | "warn" | "off"; action?: "pair-again" };

export function present(state: ConnectionState, now: number): Presented {
  switch (state.kind) {
    case "online":
      return { label: "Connected", tone: "ok" };
    case "connecting":
      return { label: "Connecting…", tone: "busy" };
    case "backoff": {
      const seconds = Math.max(1, Math.ceil((state.retryAt - now) / 1000));
      return { label: `Can't reach it. Trying again in ${seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`}`, tone: "warn" };
    }
    case "blocked":
      return state.reason === "unauthorized"
        ? { label: "This phone is no longer paired", tone: "warn", action: "pair-again" }
        : { label: "That address belongs to another computer", tone: "warn", action: "pair-again" };
    case "stopped":
      return { label: "Off", tone: "off" };
  }
}
