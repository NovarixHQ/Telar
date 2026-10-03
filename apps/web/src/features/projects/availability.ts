import type { ProjectAvailability } from "@telar/engine-client";

export type Away = Exclude<ProjectAvailability, "available">;

export const isAway = (availability: ProjectAvailability | undefined): availability is Away =>
  availability !== undefined && availability !== "available";

const AWAY: Record<Away, { label: string; title: string; reason: (name: string) => string }> = {
  unmounted: {
    label: "Drive away",
    title: "The drive is not connected",
    reason: (name) => `The drive holding ${name} is not connected. Plug it back in; its conversations and settings are all still here.`,
  },
  missing: {
    label: "Folder gone",
    title: "The project folder is gone",
    reason: (name) => `The folder for ${name} is not on this machine any more.`,
  },
  denied: {
    label: "No access",
    title: "Access to the folder is denied",
    reason: (name) => `macOS or a security tool is denying access to the folder for ${name}. Allow access and it comes back on its own.`,
  },
  unresponsive: {
    label: "Not responding",
    title: "The drive is not responding",
    reason: (name) => `The drive holding ${name} isn't responding. It may be disconnected or blocked by security software.`,
  },
};

export const awayLabel = (away: Away): string => AWAY[away].label;

export const awayTitle = (away: Away): string => AWAY[away].title;

/** One sentence on why nothing can be read or run, and what brings it back. */
export const awayReason = (away: Away, name = "this project"): string => AWAY[away].reason(name);
