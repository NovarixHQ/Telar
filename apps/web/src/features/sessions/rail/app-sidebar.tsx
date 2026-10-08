"use client";

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { useCommandHandlers } from "@/features/commands";
import { HostMarksShown } from "@/features/hosts";
import { projectSettingsHref } from "@/features/projects";
import { Sidebar, SidebarContent, SidebarFooter, SidebarRail, type SidebarResizableOptions, type SidebarWidthProposal, useSidebar } from "@/ui/sidebar";
import { activeSessionFromPathname, SESSION_PAGE_SIZE, SETTLED_PAGE_SIZE } from "../session-list";
import { APP_SIDEBAR_MAIN_MIN_WIDTH, APP_SIDEBAR_STORAGE_KEY, keepsRoomForMain, SIDEBAR_RESIZE_MIN_WIDTH } from "@/ui/sidebar-width";
import { AppSidebarFooterRow } from "./app-sidebar-footer";
import { AttentionRows, RailSessionList, RailShelves } from "./rail-list";
import { TelarSidebarHeader } from "./rail-parts";
import { RailSearch } from "./rail-search";
import { SidebarProjectFilter } from "./sidebar-project-filter";
import { useDockUnread } from "./unread";
import { useCommandHost } from "./command-host";
import { type RailData, useRailData } from "./use-rail-data";
import { useRailView } from "./use-rail-view";

const APP_SIDEBAR_RESIZABLE = {
  minWidth: SIDEBAR_RESIZE_MIN_WIDTH,
  storageKey: APP_SIDEBAR_STORAGE_KEY,
  shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }: SidebarWidthProposal) =>
    keepsRoomForMain(currentWidth, nextWidth, wrapper.getBoundingClientRect().width, APP_SIDEBAR_MAIN_MIN_WIDTH),
} satisfies SidebarResizableOptions;

export function connectedHosts(data: Pick<RailData, "hosts" | "unreachable">): number {
  return 1 + data.hosts.filter((host) => !data.unreachable.has(host.id)).length;
}

function SidebarBody() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const data = useRailData();
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [sessionLimit, setSessionLimit] = useState(SESSION_PAGE_SIZE);
  const [settledLimit, setSettledLimit] = useState(SETTLED_PAGE_SIZE);
  const onNavigate = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const activeSessionId = activeSessionFromPathname(pathname);
  const view = useRailView(data, { query, activeSessionId, sessionLimit, settledLimit });
  useDockUnread(data.sessions, activeSessionId, view.env.bandFor);
  const { element: palette, run, openPalette, composerTarget, startSession, openSession, pickerTargets, soleTarget, go } = useCommandHost({
    data,
    railRows: view.railRows,
    activeSessionId,
    railQuery: query,
    onNavigate,
  });

  const results = view.list.sessions;
  const selectedSearchIndex = results.length ? Math.min(searchIndex, results.length - 1) : -1;
  const openProjectSettings = (projectId: string) => go(projectSettingsHref(projectId));

  const localProjectId = composerTarget && !composerTarget.hostId ? composerTarget.projectId : undefined;
  useCommandHandlers(localProjectId ? { "project-settings": () => openProjectSettings(localProjectId) } : {}, [localProjectId]);

  const filter = view.projectFilter;
  const listProps = { data, view, query, selectedSearchIndex, onNavigate, startSession, openProjectSettings };
  return (
    <>
      {palette}
      <TelarSidebarHeader />
      <HostMarksShown value={connectedHosts(data) > 1}>
        <SidebarContent>
          <RailSearch
            query={query}
            onType={(value) => {
              setQuery(value);
              setSearchIndex(0);
              setSessionLimit(SESSION_PAGE_SIZE);
            }}
            onClear={() => {
              setQuery("");
              setSearchIndex(0);
            }}
            results={results}
            selectedIndex={selectedSearchIndex}
            setSelectedIndex={setSearchIndex}
            onOpen={openSession}
            filter={
              pickerTargets.length > 1 ? (
                <SidebarProjectFilter targets={pickerTargets} selected={view.projectsShown} onToggle={filter.toggle} onClear={filter.clear} />
              ) : undefined
            }
            soleTargetName={soleTarget?.name}
            run={run}
          />
          {view.grouped && <AttentionRows rows={view.grouped.attention} env={view.env} />}
          <RailSessionList
            {...listProps}
            onShowMore={() => setSessionLimit((limit) => limit + SESSION_PAGE_SIZE)}
            canStart={Boolean(composerTarget)}
            onAddProject={() => openPalette("sources")}
          />
          {!view.list.flat && (
            <RailShelves data={data} view={view} settledLimit={settledLimit} onMoreSettled={() => setSettledLimit((limit) => limit + SETTLED_PAGE_SIZE)} />
          )}
        </SidebarContent>
      </HostMarksShown>
      <SidebarFooter>
        <AppSidebarFooterRow onNavigate={onNavigate} />
      </SidebarFooter>
    </>
  );
}

function AppSidebarRail() {
  const { open } = useSidebar();
  return open ? <SidebarRail className="after:bg-transparent" /> : null;
}

export { SidebarBody as AppSidebarBody };

export function AppSidebar() {
  return (
    <Sidebar variant="floating" collapsible="offcanvas" resizable={APP_SIDEBAR_RESIZABLE} className="p-[var(--app-island-inset)]">
      <SidebarBody />
      <AppSidebarRail />
    </Sidebar>
  );
}

export function RaillessCommands() {
  const data = useRailData();
  const activeSessionId = activeSessionFromPathname(usePathname());
  const view = useRailView(data, { query: "", activeSessionId, sessionLimit: SESSION_PAGE_SIZE, settledLimit: SETTLED_PAGE_SIZE });
  return useCommandHost({ data, railRows: view.railRows, activeSessionId }).element;
}
