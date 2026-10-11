/** A trial changes only how the UI looks or behaves on this device; engine data is the same either way. */
export type Experiment = { id: string; label: string; hint: string; decideBy: string };

export const EXPERIMENTS: readonly Experiment[] = [
  { id: "cite-projects", label: "Cite projects", hint: "Typing a project's name after @ offers the project, so the agent can search its past sessions.", decideBy: "2026-11-07" },
  { id: "agent-catalog", label: "Agent catalog", hint: "Install agents from the public catalog as new logins on the Providers page.", decideBy: "2026-11-06" },
];

export function decideByLabel(decideBy: string): string {
  return new Date(`${decideBy}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
