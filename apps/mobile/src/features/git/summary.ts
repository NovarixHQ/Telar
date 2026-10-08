import type { GitChangeStatus, GitFileChange, SessionDiff } from "@telar/engine-client";

export type StatusTone = "emerald" | "red" | "sky" | "amber";

const BADGE: Record<GitChangeStatus, { letter: string; tone: StatusTone }> = {
  added: { letter: "A", tone: "emerald" },
  untracked: { letter: "U", tone: "emerald" },
  deleted: { letter: "D", tone: "red" },
  renamed: { letter: "R", tone: "sky" },
  modified: { letter: "M", tone: "amber" },
};

export type FileLine = { path: string; status: GitChangeStatus; letter: string; tone: StatusTone; name: string; detail?: string; added?: number; removed?: number; binary: boolean };

const positive = (count: number | undefined) => (count && count > 0 ? count : undefined);

export function fileLine(file: GitFileChange): FileLine {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const folder = slash > 0 ? file.path.slice(0, slash) : undefined;
  const detail = file.renamedFrom ? `from ${file.renamedFrom}` : folder;
  const added = positive(file.linesAdded);
  const removed = positive(file.linesRemoved);
  return { path: file.path, status: file.status, ...BADGE[file.status], name, ...(detail ? { detail } : {}), ...(added ? { added } : {}), ...(removed ? { removed } : {}), binary: file.binary === true };
}

/** How many of `total` blocks are green and red for these line counts; any change gets at least one block. */
export function statBlocks(added: number, removed: number, total = 5): { added: number; removed: number } {
  const lines = added + removed;
  if (lines <= 0) return { added: 0, removed: 0 };
  let green = Math.round((added / lines) * total);
  if (added > 0) green = Math.max(green, 1);
  if (removed > 0) green = Math.min(green, total - 1);
  return { added: green, removed: total - green };
}

/** What the reader must know before trusting the list. */
export function diffNotes(diff: SessionDiff): string[] {
  const notes: string[] = [];
  if (!diff.repository) notes.push("This session isn't in a git repository.");
  if (!diff.base) notes.push("No recorded base — committed work is not included.");
  if (diff.files.length === 0 && diff.commits.length === 0 && diff.filesIncomplete) notes.push("Nothing was listed — which is not the same as nothing having changed.");
  if (diff.filesIncomplete) {
    notes.push(
      diff.filesIncomplete === "timeout"
        ? "git did not answer in time — this list may be missing files and the counts may be low. Pull to ask again."
        : "git could not read this checkout's changes — this list may be missing files and the counts may be low.",
    );
  }
  if (diff.commitsIncomplete) {
    notes.push(
      diff.commitsIncomplete === "timeout"
        ? "git did not answer in time for this session's commits — work it has already committed may not be listed. Pull to ask again."
        : "git could not read this session's commits — work it has already committed may not be listed.",
    );
  }
  if (diff.baseUnverified) notes.push("Nothing confirmed the starting point — it is the one recorded when this checkout was cut.");
  if (diff.truncated) notes.push("File list truncated.");
  return notes;
}

export const fileCount = (count: number) => (count === 1 ? "1 file" : `${count} files`);

const UNITS: [number, (n: number) => string][] = [
  [365 * 86_400, (n) => `${n} yr.`],
  [30 * 86_400, (n) => `${n} mo.`],
  [7 * 86_400, (n) => `${n} wk.`],
  [86_400, (n) => (n === 1 ? "1 day" : `${n} days`)],
  [3_600, (n) => `${n} hr.`],
  [60, (n) => `${n} min.`],
];

/** iOS's abbreviated relative date, as the Swift app shows commit times: "3 hr. ago". */
export function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  for (const [size, label] of UNITS) if (seconds >= size) return `${label(Math.floor(seconds / size))} ago`;
  return `${seconds} sec. ago`;
}
