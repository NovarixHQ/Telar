import type { HostConnection } from "../../platform/connection";
import { completionsFor, type Completion, type CompletionAction, type CompletionContext } from "./completions";
import { detectTrigger, replaceTrigger } from "./trigger";
import { useSkills, type SkillsSource } from "./use-skills";

const NO_SKILLS = { skills: [], commands: [] };

type Options = {
  host: HostConnection | undefined;
  draft: string;
  caret: number;
  /** No list while dictating: the words are still arriving. */
  listening: boolean;
  source: SkillsSource | undefined;
  context: Omit<CompletionContext, "skills">;
  setDraft: (text: string) => void;
  /** Runs what a command row does beyond editing the text. */
  onAction: (action: Exclude<CompletionAction, { kind: "insert" }>) => void;
};

/** The `/`, `$` and `@` list for the trigger at the caret, and what picking a row does to the draft. */
export function useCompletions({ host, draft, caret, listening, source, context, setDraft, onAction }: Options) {
  const trigger = listening ? undefined : detectTrigger(draft, caret);
  const skills = useSkills(host, source, trigger !== undefined && trigger.kind !== "mention");
  if (!trigger) return undefined;
  const rows = completionsFor(trigger, { ...context, skills: skills.skills ?? NO_SKILLS });
  const onPick = ({ action }: Completion) => {
    setDraft(replaceTrigger(draft, trigger, action.kind === "insert" ? `${action.text} ` : ""));
    if (action.kind !== "insert") onAction(action);
  };
  return { rows, loading: skills.loading && trigger.kind !== "mention", onPick };
}
