import type { SessionAssignment } from "@telar/engine-client";
import type { RailRow } from "./rail";

export type RailFamily = { key: string; count: number; needsYou: number; working: number };
export type NestedRow = { row: RailRow; family?: RailFamily; nested: boolean };

/** The session that started this one, else the earliest live assignment's sender. */
export function parentOf(sessionId: string, startedFrom: string | undefined, assignments: readonly SessionAssignment[] = []): string | undefined {
  const first = assignments.filter((assignment) => assignment.outcome !== "detached").sort((left, right) => left.receivedAt - right.receivedAt)[0];
  const parent = startedFrom ?? first?.fromSessionId;
  return parent && parent !== sessionId ? parent : undefined;
}

const foldKey = (row: Pick<RailRow, "hostId" | "sessionId">) => `${row.hostId}:${row.sessionId}`;

/** Folds builders under the session that tasked them; a pinned row is always a root. Unexpanded families still show children that need you. */
export function nestRail(rail: { pinned: RailRow[]; rows: RailRow[] }, expanded: ReadonlySet<string>): { pinned: NestedRow[]; rows: NestedRow[] } {
  const ordered = [...rail.pinned, ...rail.rows];
  const pinned = new Set(rail.pinned.map((row) => row.key));
  const byKey = new Map(ordered.map((row) => [row.key, row]));
  const rootOf = (row: RailRow): RailRow => {
    const seen = new Set([row.key]);
    let current = row;
    while (!pinned.has(current.key) && current.parentId) {
      const parent = byKey.get(`${current.hostId}/${current.parentId}`);
      if (!parent) break;
      if (seen.has(parent.key)) return row;
      seen.add(parent.key);
      current = parent;
    }
    return current;
  };
  const roots: RailRow[] = [];
  const children = new Map<string, RailRow[]>();
  for (const row of ordered) {
    const root = rootOf(row);
    if (root === row) roots.push(row);
    else children.set(root.key, [...(children.get(root.key) ?? []), row]);
  }
  const draw = (root: RailRow): NestedRow[] => {
    const kids = children.get(root.key) ?? [];
    const key = foldKey(root);
    const family = kids.length
      ? { key, count: kids.length, needsYou: kids.filter((kid) => kid.activity === "blocked").length, working: kids.filter((kid) => kid.activity === "working" || kid.activity === "queued" || kid.activity === "monitoring").length }
      : undefined;
    const shown = expanded.has(key) ? kids : kids.filter((kid) => kid.activity === "blocked");
    return [{ row: root, nested: false, ...(family ? { family } : {}) }, ...shown.map((row) => ({ row, nested: true }))];
  };
  return { pinned: roots.filter((row) => pinned.has(row.key)).flatMap(draw), rows: roots.filter((row) => !pinned.has(row.key)).flatMap(draw) };
}
