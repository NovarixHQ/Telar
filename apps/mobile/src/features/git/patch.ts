import { wordChanges, type Span } from "./word-diff";

type CodeRow = { kind: "add" | "del" | "ctx"; text: string; old?: number; new?: number; changed?: Span[] };

export type PatchRow = { kind: "hunk"; text: string } | CodeRow | { kind: "note"; text: string };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** A unified patch as rows with old and new line numbers; file headers are dropped. */
export function parsePatch(patch: string): PatchRow[] {
  const rows: PatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
    } else if (!inHunk) {
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), new: newLine++ });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), old: oldLine++ });
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "note", text: line.slice(2) });
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", text: line.slice(1), old: oldLine++, new: newLine++ });
    } else if (line.startsWith("diff --git")) {
      inHunk = false;
    }
  }
  markWordChanges(rows);
  return rows;
}

// Pairs each run of removed lines with the added run right after it, line by line, as git's word diff does.
function markWordChanges(rows: PatchRow[]) {
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind !== "del") {
      index++;
      continue;
    }
    const removedStart = index;
    while (index < rows.length && rows[index]!.kind === "del") index++;
    const addedStart = index;
    while (index < rows.length && rows[index]!.kind === "add") index++;
    const pairs = Math.min(addedStart - removedStart, index - addedStart);
    for (let offset = 0; offset < pairs; offset++) {
      const before = rows[removedStart + offset] as CodeRow;
      const after = rows[addedStart + offset] as CodeRow;
      const spans = wordChanges(before.text, after.text);
      if (!spans) continue;
      before.changed = spans.old;
      after.changed = spans.new;
    }
  }
}

/** The old and new sides of the rows, so each can be highlighted as whole code. */
export function patchSides(rows: PatchRow[]): { old: string[]; new: string[] } {
  const old: string[] = [];
  const next: string[] = [];
  for (const row of rows) {
    if (row.kind === "del" || row.kind === "ctx") old.push(row.text);
    if (row.kind === "add" || row.kind === "ctx") next.push(row.text);
  }
  return { old, new: next };
}
