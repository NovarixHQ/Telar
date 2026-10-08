import { useExpandedParents, flatRailRows, flattenSessions } from "./flat-rail";
import { useInboxPolicy } from "../inbox-policy";
import { appliedProjectFilter, filterSessionsToProjects, projectFilterKey, useProjectFilter } from "@/features/projects";
import {
  groupSessions,
  moveProjectGroupStep,
  PINNED_ROW_SCOPE,
  railJumpSlots,
  railRowsForCommandKeys,
  useCollapsedGroups,
} from "../session-groups";
import { bandOf, deriveSessionList, sessionKey, windowFor, type SidebarSession } from "../session-list";
import { useSidebarLayout } from "./sidebar-layout";
import type { RowEnv } from "./rail-parts";
import type { RailData } from "./use-rail-data";
import { useRailDrag } from "./use-rail-drag";

type ViewInput = { query: string; activeSessionId: string | undefined; sessionLimit: number; settledLimit: number };

/** What the rail draws from the data: the filtered list, its grouping, drag, rail order and jump slots. */
export function useRailView(data: RailData, { query, activeSessionId, sessionLimit, settledLimit }: ViewInput) {
  const { policy } = useInboxPolicy();
  const autoSettleAfterHours = policy.autoSettleAfterHours;
  const collapsed = useCollapsedGroups();
  const projectFilter = useProjectFilter();
  const layout = useSidebarLayout();
  const expanded = useExpandedParents();

  const knownProjectKeys = [
    ...data.projects.map((project) => projectFilterKey(project.id)),
    ...data.remoteProjects.map((project) => projectFilterKey(project.id, project.hostId)),
  ];
  const projectsShown = appliedProjectFilter(projectFilter.selected, knownProjectKeys);
  const list = deriveSessionList({
    sessions: filterSessionsToProjects(data.sessions, projectsShown),
    query,
    ...(activeSessionId ? { activeSessionId } : {}),
    now: data.renderedAt,
    autoSettleAfterHours,
    windowsByHost: data.hostWindows,
    limit: sessionLimit,
    settledLimit,
    order: layout.mode === "flat" ? "activity" : "created",
  });
  let shelvedOnEngines = 0;
  for (const [key, count] of data.shelvedOnEngines) if (projectsShown.size === 0 || projectsShown.has(key)) shelvedOnEngines += count;
  const settledCount = data.settledOpen ? list.settledCount : Math.max(list.settledCount, shelvedOnEngines);
  const bandFor = (session: SidebarSession) =>
    bandOf(session, { now: data.renderedAt, autoSettleAfterHours: windowFor(session, autoSettleAfterHours, data.hostWindows) });
  const grouped =
    list.flat || layout.mode === "flat" ? undefined : groupSessions(list, layout.order, { sessions: layout.sessionOrder, pinned: layout.pinnedOrder });
  const flatEntries = !list.flat && layout.mode === "flat" ? flattenSessions(list, layout.pinnedOrder) : undefined;
  const drawnGroups = grouped ? grouped.groups : [];
  const drawnGroupKeys = drawnGroups.map((group) => group.key);

  const drag = useRailDrag(layout, Boolean(grouped), drawnGroupKeys);
  const pinnedRowDrag = drag.rowDrag(PINNED_ROW_SCOPE, grouped ? grouped.pinned.map((session) => sessionKey(session)) : []);
  const moveGroup = (key: string, direction: "up" | "down") => {
    const next = moveProjectGroupStep(layout.order, drawnGroupKeys, key, direction);
    return next && (() => void layout.setOrder(next));
  };

  const railRows = grouped
    ? railRowsForCommandKeys({ ...grouped, groups: drawnGroups }, collapsed.collapsed)
    : flatEntries
      ? flatRailRows(flatEntries, expanded.expanded, activeSessionId)
      : list.sessions;
  const jumpSlots = railJumpSlots(railRows);
  const env: RowEnv = {
    ...(activeSessionId ? { activeSessionId } : {}),
    renderedAt: data.renderedAt,
    bandFor,
    onRowChanged: data.onRowChanged,
    jumpSlotFor: (key) => jumpSlots.get(key),
  };

  return {
    projectFilter,
    projectsShown,
    layout,
    list,
    settledCount,
    grouped,
    flatEntries,
    drawnGroups,
    drawnGroupKeys,
    drag,
    pinnedRowDrag,
    moveGroup,
    collapsed,
    expanded,
    railRows,
    env,
    showingStale: data.unavailable && data.sessions.length > 0,
  };
}

export type RailView = ReturnType<typeof useRailView>;
