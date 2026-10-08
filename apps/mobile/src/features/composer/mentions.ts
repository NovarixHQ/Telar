import { sessionReference } from "@telar/client/composer";

export type MentionTarget = { sessionId: string; title: string; projectId?: string; projectName?: string };

export type MentionQuery = { start: number; query: string };

const MAX = 4;

/** The `@word` being typed at the end of the draft, if any. */
export function mentionQuery(draft: string): MentionQuery | undefined {
  const match = /(^|\s)@([^\s@]*)$/.exec(draft);
  if (!match) return undefined;
  return { start: match.index + match[1]!.length, query: match[2]!.toLowerCase() };
}

/** Up to four other sessions, the current project's first, matching the typed words in their title or project. */
export function mentionCandidates(targets: readonly MentionTarget[], query: string, current: { sessionId: string; projectId?: string }): MentionTarget[] {
  const words = query.split(/\s+/).filter(Boolean);
  return targets
    .filter((target) => target.sessionId !== current.sessionId)
    .filter((target) => words.every((word) => `${target.title} ${target.projectName ?? ""}`.toLowerCase().includes(word)))
    .map((target, index) => ({ target, rank: (current.projectId && target.projectId === current.projectId ? 0 : 1) * 10_000 + index }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAX)
    .map(({ target }) => target);
}

/** Replaces the typed `@word` with the sentence that points the agent at the session. */
export function applyMention(draft: string, at: MentionQuery, target: MentionTarget): string {
  return `${draft.slice(0, at.start)}${sessionReference({ id: target.sessionId, title: target.title }).text} `;
}
