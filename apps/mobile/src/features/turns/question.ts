import type { UserInputField } from "@telar/engine-client";

export type QuestionPage = { key: string; question: string; header?: string; choices: string[]; descriptions: Record<string, string>; multiple: boolean };

/** One question per page; a page is answered by its picked choices or by typed text, never both. */
export type QuestionDraft = { pages: QuestionPage[]; index: number; selected: Record<string, string[]>; custom: Record<string, string> };

export type Answer = string | string[];

/** A draft for questions made only of choices and free text; other field kinds return undefined. */
export function questionDraft(fields: readonly UserInputField[]): QuestionDraft | undefined {
  if (!fields.length || !fields.every((field) => field.kind === "choice" || field.kind === "text")) return undefined;
  const pages = fields.map((field) => ({
    key: field.key,
    question: field.label,
    ...(field.header ? { header: field.header } : {}),
    choices: field.choices ?? [],
    descriptions: field.descriptions ?? {},
    multiple: field.kind === "choice" && field.multiple === true,
  }));
  return { pages, index: 0, selected: {}, custom: {} };
}

export const currentPage = (draft: QuestionDraft): QuestionPage => draft.pages[draft.index]!;
export const isLast = (draft: QuestionDraft): boolean => draft.index >= draft.pages.length - 1;
export const isPicked = (draft: QuestionDraft, choice: string): boolean => (draft.selected[currentPage(draft).key] ?? []).includes(choice);
export const customText = (draft: QuestionDraft): string => draft.custom[currentPage(draft).key] ?? "";

export function toggle(draft: QuestionDraft, choice: string): QuestionDraft {
  const page = currentPage(draft);
  const chosen = draft.selected[page.key] ?? [];
  const already = chosen.includes(choice);
  const next = page.multiple ? (already ? chosen.filter((item) => item !== choice) : [...chosen, choice]) : already ? [] : [choice];
  return { ...draft, selected: { ...draft.selected, [page.key]: next }, custom: { ...draft.custom, [page.key]: "" } };
}

export function setCustom(draft: QuestionDraft, text: string): QuestionDraft {
  const { key } = currentPage(draft);
  return { ...draft, custom: { ...draft.custom, [key]: text }, selected: text.trim() ? { ...draft.selected, [key]: [] } : draft.selected };
}

export function answerFor(draft: QuestionDraft, page: QuestionPage): Answer | undefined {
  const typed = (draft.custom[page.key] ?? "").trim();
  if (typed) return page.multiple ? [typed] : typed;
  const chosen = draft.selected[page.key] ?? [];
  if (!chosen.length) return undefined;
  return page.multiple ? page.choices.filter((choice) => chosen.includes(choice)) : chosen[0];
}

export const canAdvance = (draft: QuestionDraft): boolean => answerFor(draft, currentPage(draft)) !== undefined;

export function move(draft: QuestionDraft, forward: boolean): QuestionDraft {
  if (!forward) return { ...draft, index: Math.max(0, draft.index - 1) };
  return canAdvance(draft) && !isLast(draft) ? { ...draft, index: draft.index + 1 } : draft;
}

/** Every page's answer keyed by field, the shape the engine resolves a question with; undefined until all are answered. */
export function answers(draft: QuestionDraft): Record<string, Answer> | undefined {
  const all: Record<string, Answer> = {};
  for (const page of draft.pages) {
    const answer = answerFor(draft, page);
    if (answer === undefined) return undefined;
    all[page.key] = answer;
  }
  return all;
}
