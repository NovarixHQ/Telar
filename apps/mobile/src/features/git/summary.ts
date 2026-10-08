import type { GitChangeStatus, GitFileChange, SessionDiff } from "@telar/engine-client";

const LETTER: Record<GitChangeStatus, string> = { added: "A", deleted: "D", renamed: "R", untracked: "U", modified: "M" };

export type FileLine = { path: string; letter: string; name: string; detail?: string; counts: string };

export function fileLine(file: GitFileChange): FileLine {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const folder = slash > 0 ? file.path.slice(0, slash) : undefined;
  const detail = file.renamedFrom ? `from ${file.renamedFrom}` : folder;
  const counts = file.binary ? "binary" : file.linesAdded === undefined && file.linesRemoved === undefined ? "" : `+${file.linesAdded ?? 0} −${file.linesRemoved ?? 0}`;
  return { path: file.path, letter: LETTER[file.status], name, ...(detail ? { detail } : {}), counts };
}

/** What the reader must know before trusting the list. */
export function diffWarnings(diff: SessionDiff): string[] {
  const warnings: string[] = [];
  if (!diff.repository) warnings.push("This session isn't in a git repository.");
  if (!diff.base) warnings.push("No base was recorded, so changes are measured against the current branch.");
  if (diff.baseUnverified) warnings.push("The base couldn't be checked; the list may include work from before this session.");
  if (diff.filesIncomplete) warnings.push("Git didn't finish listing files. Nothing listed doesn't mean nothing changed.");
  if (diff.commitsIncomplete) warnings.push("Git didn't finish listing commits.");
  if (diff.truncated) warnings.push("The list is cut short.");
  return warnings;
}

export function diffHeadline(diff: SessionDiff): string {
  const files = `${diff.files.length} ${diff.files.length === 1 ? "file" : "files"}`;
  return `${files} · +${diff.linesAdded} −${diff.linesRemoved}`;
}
