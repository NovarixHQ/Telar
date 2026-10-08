import type { DriverCapabilities } from "./capabilities";
import type { DriverRun } from "./contract";

export function withCarriedContext<T extends Pick<DriverRun, "prompt" | "carriedContext">>(run: T, context: string | undefined, capabilities: DriverCapabilities): T {
  if (!context) return run;
  if (capabilities.contextInjection === "native") return { ...run, carriedContext: context };
  return { ...run, prompt: inlineCarriedContext(context, run.prompt) };
}

export function inlineCarriedContext(context: string, prompt: string): string {
  return `${context}\n\n---\n\n${prompt}`;
}
