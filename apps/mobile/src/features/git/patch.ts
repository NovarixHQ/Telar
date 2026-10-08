export type PatchRow =
  | { kind: "hunk"; text: string }
  | { kind: "add" | "del" | "ctx"; text: string; old?: number; new?: number }
  | { kind: "note"; text: string };

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
  return rows;
}
