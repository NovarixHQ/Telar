import type { SidebarLayout } from "@telar/engine-client";
import type { RailRow } from "./rail";

export type ProjectPlace = { hostId: string; projectId: string; name: string };

export type RailProject = {
  id: string;
  /** The key the computers' saved orders use: the repository for a shared remote, otherwise the project id. */
  layoutKey: string;
  places: ProjectPlace[];
  name: string;
  away?: string;
  /** The first row, which carries the project's avatar. */
  mark: RailRow;
  rows: RailRow[];
};

export type GroupedRail = { attention: RailRow[]; pinned: RailRow[]; projects: RailProject[] };

type Layouts = ReadonlyMap<string, SidebarLayout | undefined>;

const REPO = "repo:";

/** Rows the saved order ranks first, in that order, then the rest as they came. */
function arranged(rows: readonly RailRow[], rank: (row: RailRow) => number): RailRow[] {
  const placed: { at: number; arrived: number; row: RailRow }[] = [];
  const rest: RailRow[] = [];
  rows.forEach((row, arrived) => {
    const at = rank(row);
    if (at >= 0) placed.push({ at, arrived, row });
    else rest.push(row);
  });
  placed.sort((left, right) => left.at - right.at || left.arrived - right.arrived);
  return [...placed.map((entry) => entry.row), ...rest];
}

const compare = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

function agreedAway(rows: readonly RailRow[]): string | undefined {
  const states = new Set(rows.map((row) => row.projectAway));
  return states.size === 1 ? [...states][0] : undefined;
}

/** Group by Project: what needs you, then pinned rows, then a band per project shared across computers by its remote. */
export function groupRail(active: readonly RailRow[], layouts: Layouts, hostName: (hostId: string) => string | undefined): GroupedRail {
  const attention = active.filter((row) => row.activity === "blocked");
  const pinned = arranged(
    active.filter((row) => row.activity !== "blocked" && row.pinned),
    (row) => layouts.get(row.hostId)?.pinnedOrder.indexOf(row.sessionId) ?? -1,
  );
  const groups = new Map<string, RailRow[]>();
  for (const row of active) {
    if (row.activity === "blocked" || row.pinned || !row.projectId) continue;
    const key = row.projectRemote ? `${REPO}${row.projectRemote}` : `${row.hostId}:${row.projectId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const projects = [...groups].map(([id, rows]): RailProject => {
    const places = new Map<string, ProjectPlace & { row: RailRow }>();
    for (const row of rows) {
      const key = `${row.hostId}:${row.projectId}`;
      if (!places.has(key)) places.set(key, { hostId: row.hostId, projectId: row.projectId!, name: row.projectName ?? row.projectId!, row });
    }
    const sorted = [...places.values()].sort((left, right) => compare(hostName(left.hostId) ?? "", hostName(right.hostId) ?? "") || (left.hostId < right.hostId ? -1 : left.hostId > right.hostId ? 1 : 0) || (left.projectId < right.projectId ? -1 : 1));
    const first = sorted[0]!;
    const layoutKey = id.startsWith(REPO) ? id : first.projectId;
    const away = agreedAway(rows);
    return {
      id,
      layoutKey,
      places: sorted.map(({ hostId, projectId, name }) => ({ hostId, projectId, name })),
      name: first.name,
      ...(away ? { away } : {}),
      mark: first.row,
      rows: arranged(rows, (row) => layouts.get(row.hostId)?.sessionOrder[layoutKey]?.indexOf(row.sessionId) ?? -1),
    };
  });
  const rank = (project: RailProject) => Math.min(...project.places.map((place) => layouts.get(place.hostId)?.projectOrder.indexOf(project.layoutKey) ?? -1).filter((at) => at >= 0), Number.MAX_SAFE_INTEGER);
  projects.sort((left, right) => rank(left) - rank(right) || compare(left.name, right.name) || compare(hostName(left.places[0]!.hostId) ?? "", hostName(right.places[0]!.hostId) ?? "") || (left.id < right.id ? -1 : 1));
  return { attention, pinned, projects };
}

/** The projectOrder each computer must save after a band moves one place, for the computers whose order changed. */
export function movedProjectOrders(projects: readonly RailProject[], id: string, offset: -1 | 1, layouts: Layouts): Map<string, string[]> {
  const index = projects.findIndex((project) => project.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= projects.length) return new Map();
  const drawn = [...projects];
  [drawn[index], drawn[target]] = [drawn[target]!, drawn[index]!];
  const byHost = new Map<string, string[]>();
  for (const project of drawn) for (const place of project.places) byHost.set(place.hostId, [...(byHost.get(place.hostId) ?? []), project.layoutKey]);
  const changed = new Map<string, string[]>();
  for (const [hostId, order] of byHost) {
    const stored = layouts.get(hostId)?.projectOrder ?? [];
    if (order.join("\n") === stored.filter((key) => order.includes(key)).join("\n")) continue;
    changed.set(hostId, [...order, ...stored.filter((key) => !order.includes(key))]);
  }
  return changed;
}

/** Snoozed rows wake soonest first. */
export const byWakeTime = (rows: readonly RailRow[]): RailRow[] => [...rows].sort((left, right) => (left.snoozedUntil ?? 0) - (right.snoozedUntil ?? 0));
