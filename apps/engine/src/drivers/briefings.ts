import { DISPLAY_BRIEFING } from "../domains/agent-tools";
import { BROWSER_BRIEFING } from "../domains/browser";
import { pluginBriefings } from "../domains/plugins";
import { RUN_BRIEFING } from "../domains/terminal";
import type { DriverRun } from "./contract";

/** What every driver tells the model about this turn, in this order. */
export function driverBriefings(input: Pick<DriverRun, "orientation" | "mainBriefing" | "browserSocket" | "run" | "display" | "plugins">): string[] {
  return [
    ...(input.orientation ? [input.orientation] : []),
    ...(input.mainBriefing ? [input.mainBriefing] : []),
    ...(input.browserSocket ? [BROWSER_BRIEFING] : []),
    ...(input.run ? [RUN_BRIEFING] : []),
    ...(input.display ? [DISPLAY_BRIEFING] : []),
    ...pluginBriefings(Object.keys(input.plugins ?? {})),
  ];
}
