import type { SymbolName } from "../../ui";

export type PanelTab = "diff" | "editor" | "agents" | "simulator" | "terminal" | "browser";

export const CORE_TABS: readonly PanelTab[] = ["diff", "editor", "agents", "simulator", "terminal", "browser"];

/** Surfaces this app can draw so far; the rest are listed but can't be opened. */
export const DRAWN_TABS: ReadonlySet<PanelTab> = new Set(["diff", "editor", "agents", "terminal", "browser"]);

export const TAB_INFO: Record<PanelTab, { label: string; icon: SymbolName; blurb: string }> = {
  diff: { label: "Diff", icon: "plus.forwardslash.minus", blurb: "What this session changed" },
  editor: { label: "Files", icon: "folder", blurb: "The checkout, file by file" },
  agents: { label: "Session", icon: "info.circle", blurb: "What this session runs on, and who works with it" },
  simulator: { label: "Simulator", icon: "iphone", blurb: "This computer's simulators, live and controllable" },
  terminal: { label: "Terminal", icon: "terminal", blurb: "Run a command on the computer and watch it" },
  browser: { label: "Browser", icon: "globe", blurb: "The pages this session's browser has open" },
};

export const isPanelTab = (value: unknown): value is PanelTab => typeof value === "string" && (CORE_TABS as readonly string[]).includes(value);
