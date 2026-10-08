export type PromptRecall = { index: number; recalled: string; draft: string };

type SentTurn = { prompt: string; kind?: string; origin?: string };

export function recallablePrompts(turns: readonly SentTurn[]): string[] {
  const prompts: string[] = [];
  for (const turn of turns) {
    if (turn.kind === "import" || turn.kind === "compact" || (turn.origin && turn.origin !== "user")) continue;
    const prompt = turn.prompt.trim();
    if (prompt && prompt !== prompts.at(-1)) prompts.push(prompt);
  }
  return prompts;
}

export function stepRecall(
  direction: "back" | "forward",
  prompts: readonly string[],
  recall: PromptRecall | undefined,
  draft: string,
): { recall?: PromptRecall; draft: string } | undefined {
  const found = recall?.recalled !== draft ? -1 : prompts[recall.index] === draft ? recall.index : prompts.lastIndexOf(draft);
  const active = recall && found >= 0 ? { ...recall, index: found } : undefined;
  if (direction === "back") {
    if (!active && draft.trim()) return undefined;
    const index = active ? active.index - 1 : prompts.length - 1;
    const prompt = prompts[index];
    if (prompt === undefined) return undefined;
    return { recall: { index, recalled: prompt, draft: active?.draft ?? draft }, draft: prompt };
  }
  if (!active) return undefined;
  const prompt = prompts[active.index + 1];
  if (prompt === undefined) return { draft: active.draft };
  return { recall: { ...active, index: active.index + 1, recalled: prompt }, draft: prompt };
}
