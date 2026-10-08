"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { EngineEvent, Item, Turn, TurnState } from "@telar/engine-client";
import { attachmentUrl, PluginSurface, type PluginPanelSource, isPluginSurface } from "@/features/plugins";
import { desktopBrowserBridge } from "@/features/browser";
import { diffTabParams, readDiffTab, type DiffTab, diffTurns, type DiffTurn } from "@/features/git";
import type { TelarReference } from "@/features/composer";
import type { EditorState, OpenIntent } from "@/features/files";
import { forgeParams, readForgeOpen, type ForgeOpen } from "@/features/github";
import { useSuspendSidebar } from "@/ui/sidebar";
import { useSidebarPrefs } from "@/ui/sidebar-width";
import { useCommandHandlers } from "@/features/commands";
import { cn } from "@/ui/utils";
import { journalWrites, latestBrowserState, type BrowserStartState } from "../folds";
import { useKeptTerminals } from "../hooks/use-kept-terminals";
import { defaultRightPanelWidth, RIGHT_PANEL_WIDTH_STORAGE_KEY } from "../layout";
import * as model from "../model";
import type { BrowserState, PanelTab, PanelTabItem } from "../model";
import type { PanelTabParams } from "../tabs";
import { BrowserScreenshotSurface } from "./browser-screenshot-surface";
import { PanelEmptyState } from "./panel-empty-state";
import { RightPanelResizeHandle } from "./resize-handle";
import { TabStrip } from "./tab-strip";

/*
 * Every surface is its own chunk, so a conversation whose panel is shut loads none of them. No `ssr: false`: tests
 * could never mount it. A bare `dynamic()` suspends to the nearest boundary, so each render sits under a `Suspense` here.
 */
const DesktopBrowserSurface = dynamic(() => import("@/features/browser").then((mod) => mod.DesktopBrowserSurface));
const DiffSurface = dynamic(() => import("@/features/git").then((mod) => mod.DiffSurface));
const EditorSurface = dynamic(() => import("@/features/files/components/editor-surface").then((mod) => mod.EditorSurface));
const FileViewSurface = dynamic(() => import("@/features/files").then((mod) => mod.FileViewSurface));
const NotebookSurface = dynamic(() => import("@/features/plugins/data-science/notebook-surface").then((mod) => mod.NotebookSurface));
const PdfSurface = dynamic(() => import("@/features/files/components/pdf-surface").then((mod) => mod.PdfSurface));
const TableSurface = dynamic(() => import("@/features/files/components/table-surface").then((mod) => mod.TableSurface));
const GitHubSurface = dynamic(() => import("@/features/github").then((mod) => mod.GitHubSurface));
const TerminalSurface = dynamic(() => import("@/features/terminal").then((mod) => mod.TerminalSurface));
const GroupedTerminalSurface = dynamic(() => import("@/features/terminal").then((mod) => mod.GroupedTerminalSurface));
const SimulatorSurface = dynamic(() => import("@/features/simulators/components/simulator-surface").then((mod) => mod.SimulatorSurface));
const ImageLightbox = dynamic(() => import("@/ui/image-lightbox").then((mod) => mod.ImageLightbox));

export type RightPanelProps = {
  active?: TurnState;
  enabledPlugins?: readonly string[];
  pluginPanels?: readonly PluginPanelSource[];
  /** Absent until the first message creates the session. */
  sessionId?: string;
  sessionTitle?: string;
  projectId?: string;
  branch?: string;
  items?: readonly Item[];
  turns?: readonly Turn[];
  /** Starts the session's browser, or shows its last page when one runs. Absent hides the Browser row. */
  onOpenBrowser?: () => void;
  /** Why the Browser row is dimmed: nothing runs and nothing can start here. */
  browserUnavailable?: string;
  browserStart?: BrowserStartState;
  events?: readonly EngineEvent[];
  tabs: readonly PanelTabItem[];
  /** The active instance's id, not its kind. */
  tab?: string;
  onTabChange: (id: string) => void;
  /** Routes a surface or a file-shaped id; `intent` says how deliberate the gesture was. */
  onOpenTab: (tab: PanelTab, intent?: OpenIntent) => void;
  onOpenNewTab?: (tab: PanelTab, params?: PanelTabParams) => void;
  onOpenFileInNewTab?: (path: string) => void;
  onInsertReference?: (text: string) => void;
  onAttach?: (files: readonly File[], caption?: string) => void;
  onTabParams?: (id: string, params: PanelTabParams) => void;
  onCloseTab: (id: string) => void;
  /** `toIndex` is the place in the strip without the moved tab. */
  onMoveTab?: (id: string, toIndex: number) => void;
  onClose: () => void;
  editors?: Readonly<Record<string, EditorState>>;
  onEditorChange?: (id: string, next: (current: EditorState) => EditorState) => void;
  hostId?: string;
  /** False animates the width to zero; the cockpit keeps the panel mounted through the close. */
  open?: boolean;
  /** One tab per browser page and per terminal; otherwise one Terminal tab holds a strip of them. */
  flatTabs?: boolean;
};

type Forwarded = "sessionId" | "sessionTitle" | "projectId" | "branch" | "onOpenTab" | "onOpenNewTab" | "onOpenFileInNewTab" | "onInsertReference" | "onAttach" | "active" | "enabledPlugins" | "pluginPanels" | "events" | "hostId" | "flatTabs";

/** One instance's surface, every callback already bound to that instance. */
type SurfaceProps = Pick<RightPanelProps, Forwarded> & {
  tab: PanelTabItem;
  writes: ReadonlyMap<string, number>;
  diffTurnList: readonly DiffTurn[];
  browser: BrowserState | undefined;
  onTabParams: ((params: PanelTabParams) => void) | undefined;
  onCloseSelf: () => void;
  onOpenImage: (attachmentId: string) => void;
  editor: EditorState | undefined;
  onEditorChange: ((next: (current: EditorState) => EditorState) => void) | undefined;
  /** False while kept mounted off screen, so polling surfaces can stop. */
  visible: boolean;
};

/** The surfaces that show a file or hold live state; `undefined` when the tab is none of them. */
function workspaceSurface(props: SurfaceProps): ReactNode | undefined {
  const { tab, sessionId, projectId, hostId, active, onOpenImage, onInsertReference, onOpenFileInNewTab, onTabParams, onCloseSelf, enabledPlugins = model.NO_PLUGINS } = props;
  const kind = tab.kind;
  const scoped = { ...(sessionId ? { sessionId } : {}), ...(projectId ? { projectId } : {}) };
  // Keyed by checkout and instance: a session switch replaces the surface, and two instances never share state or PTYs.
  const instanceKey = `${hostId ?? "local"}:${sessionId ?? projectId ?? "none"}:${tab.id}`;
  const notebookPath = model.notebookPanelPath(kind);
  if (notebookPath !== undefined) return <NotebookSurface path={notebookPath} {...(sessionId ? { sessionId } : {})} {...(hostId ? { hostId } : {})} {...(active ? { active } : {})} onOpenImage={onOpenImage} />;
  const tablePath = model.tablePanelPath(kind);
  if (tablePath !== undefined) return <TableSurface path={tablePath} {...(sessionId ? { sessionId } : {})} {...(active ? { active } : {})} />;
  const pdfPath = model.pdfPanelPath(kind);
  if (pdfPath !== undefined) return <PdfSurface path={pdfPath} {...scoped} {...(active ? { active } : {})} />;
  if (kind === "editor")
    return props.editor && props.onEditorChange ? (
      <EditorSurface
        key={instanceKey}
        state={props.editor}
        onState={props.onEditorChange}
        {...scoped}
        {...(hostId ? { hostId } : {})}
        {...(active ? { active } : {})}
        enabledPlugins={enabledPlugins}
        onOpenImage={onOpenImage}
        {...(onInsertReference ? { onInsertReference: (reference: TelarReference) => onInsertReference(reference.text) } : {})}
        {...(onOpenFileInNewTab ? { onOpenInNewPanelTab: onOpenFileInNewTab } : {})}
      />
    ) : null;
  if (isPluginSurface(kind))
    return (
      <PluginSurface
        id={kind}
        {...scoped}
        {...(hostId ? { hostId } : {})}
        {...(active ? { active } : {})}
        events={props.events ?? []}
        onOpenImage={onOpenImage}
        onOpenFile={(path) => props.onOpenTab(model.panelTabForPath(path, enabledPlugins))}
        panels={props.pluginPanels ?? model.NO_PANELS}
      />
    );
  if (kind === "terminal" && props.flatTabs === false)
    return (
      <GroupedTerminalSurface
        key={instanceKey}
        {...scoped}
        {...(hostId ? { hostId } : {})}
        params={tab.params}
        {...(onTabParams ? { onParams: onTabParams } : {})}
        onCloseSelf={onCloseSelf}
        visible={props.visible}
      />
    );
  if (kind === "terminal")
    return (
      <TerminalSurface
        key={instanceKey}
        {...scoped}
        {...(hostId ? { hostId } : {})}
        params={tab.params}
        {...(onTabParams ? { onParams: onTabParams } : {})}
        onCloseSelf={onCloseSelf}
        {...(props.onOpenNewTab ? { onOpenNew: () => props.onOpenNewTab!("terminal") } : {})}
        visible={props.visible}
      />
    );
  if (kind === "simulator")
    return <SimulatorSurface key={instanceKey} {...(hostId ? { hostId } : {})} {...(sessionId ? { sessionId } : {})} visible={props.visible} params={tab.params} {...(onTabParams ? { onParams: onTabParams } : {})} />;
  const filePath = model.filePanelPath(kind);
  if (filePath !== undefined) return <FileViewSurface path={filePath} {...scoped} {...(active ? { active } : {})} />;
  return undefined;
}

/** The surfaces that fold a record: the browser, the diff, the forge lists and the task rosters. */
function recordSurface(props: SurfaceProps): ReactNode {
  const { tab, sessionId, projectId, hostId, branch, active, browser, onOpenTab, onOpenNewTab, onInsertReference, onTabParams, enabledPlugins = model.NO_PLUGINS } = props;
  const kind = tab.kind;
  const pageId = model.browserTabId(kind);
  if (pageId !== undefined) {
    const bridge = desktopBrowserBridge();
    // Keyed by the session's one native scope, so moving between its page tabs keeps the surface mounted.
    const live = kind === model.LIVE_BROWSER_TAB ? { onEnded: props.onCloseSelf } : { pageId };
    if (bridge && sessionId)
      return <DesktopBrowserSurface key={sessionId} bridge={bridge} scopeKey={sessionId} {...live} {...(projectId ? { projectId } : {})} {...(props.onAttach ? { onAttach: props.onAttach } : {})} />;
    return <BrowserScreenshotSurface pageId={pageId} {...(browser ? { state: browser } : {})} {...(sessionId ? { sessionId } : {})} />;
  }
  if (kind === "diff")
    return (
      <DiffSurface
        {...(sessionId ? { sessionId } : {})}
        {...(projectId ? { projectId } : {})}
        reported={props.writes}
        suggestion={props.sessionTitle?.trim() || "Session work"}
        {...(active ? { active } : {})}
        // One object in and out: `setPanelTabParams` replaces, so a partial write would erase the rest.
        tab={readDiffTab(tab.params)}
        {...(onTabParams ? { onTabChange: (next: DiffTab) => onTabParams(diffTabParams(next)) } : {})}
        turns={props.diffTurnList}
        onOpenFile={(path) => onOpenTab(model.panelTabForPath(path, enabledPlugins))}
        {...(onOpenNewTab ? { onOpenInNewPanelTab: (path: string) => onOpenNewTab("diff", { filter: path }) } : {})}
        {...(onInsertReference ? { onInsertReference } : {})}
      />
    );
  if (kind === "issues" || kind === "pulls")
    return (
      <GitHubSurface
        kind={kind}
        {...(projectId ? { projectId } : {})}
        {...(branch ? { branch } : {})}
        open={readForgeOpen(tab.params)}
        {...(onTabParams ? { onOpenChange: (next: ForgeOpen) => onTabParams(forgeParams(next)) } : {})}
        {...(hostId ? { hostId } : {})}
        {...(onInsertReference ? { onInsertReference } : {})}
        onOpenForge={(one, number) => onOpenTab(one === "issue" ? model.issuePanelTab(number) : model.pullPanelTab(number))}
      />
    );
  return null;
}

function PanelSurface(props: SurfaceProps) {
  const workspace = workspaceSurface(props);
  return workspace === undefined ? recordSurface(props) : workspace;
}

export function RightPanel(props: RightPanelProps) {
  const { active, sessionId, tabs, tab, onCloseTab, onTabParams, editors, onEditorChange, onOpenTab, onOpenNewTab, onOpenBrowser, browserUnavailable, open = true, items = [], turns = [], events = [] } = props;
  const { browserStart = { status: "idle" }, enabledPlugins = model.NO_PLUGINS, pluginPanels = model.NO_PANELS } = props;
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = () => setFullscreen((current) => !current);
  useCommandHandlers(open ? { "panel-fullscreen": toggleFullscreen } : {}, [open]);
  const suspendRail = useSuspendSidebar();
  useEffect(() => {
    if (!suspendRail || !open || !fullscreen) return;
    suspendRail(true);
    return () => suspendRail(false);
  }, [suspendRail, open, fullscreen]);
  const panelRef = useRef<HTMLElement | null>(null);
  const prefs = useSidebarPrefs(RIGHT_PANEL_WIDTH_STORAGE_KEY);
  const width = prefs.width ?? defaultRightPanelWidth(tabs);
  const writes = useMemo(() => journalWrites(items), [items]);
  const diffTurnList = useMemo(() => diffTurns(items, turns), [items, turns]);
  const browser = useMemo(() => latestBrowserState(events), [events]);
  const activeTab = useMemo(() => tabs.find((entry) => entry.id === tab), [tabs, tab]);
  const [lightbox, setLightbox] = useState<string>();
  const keptTerminals = useKeptTerminals(tabs, activeTab);
  const showingPage = activeTab !== undefined && model.browserTabId(activeTab.kind) !== undefined;
  useEffect(() => {
    if (showingPage || !sessionId) return;
    void desktopBrowserBridge()?.setVisible(sessionId, false).catch(() => undefined);
  }, [showingPage, sessionId]);
  const launcher = model.launcherRows(tabs, {
    enabledPlugins,
    pluginPanels,
    canOpenNew: onOpenNewTab !== undefined,
    flat: props.flatTabs !== false,
    ...(onOpenBrowser ? { browser: browserUnavailable ? { unavailable: browserUnavailable } : {} } : {}),
  });
  const actions = { onOpenTab, ...(onOpenNewTab ? { onOpenNewTab } : {}), ...(onOpenBrowser ? { onOpenBrowser } : {}) };

  // Bound to this instance: a hidden Terminal must never write the active tab's params.
  const panelSurface = (entry: PanelTabItem, showing: boolean) => (
    <PanelSurface
      {...props}
      tab={entry}
      writes={writes}
      diffTurnList={diffTurnList}
      browser={browser}
      onTabParams={onTabParams ? (params) => onTabParams(entry.id, params) : undefined}
      onCloseSelf={() => onCloseTab(entry.id)}
      onOpenImage={setLightbox}
      editor={editors?.[entry.id]}
      onEditorChange={onEditorChange ? (next) => onEditorChange(entry.id, next) : undefined}
      visible={open && showing}
    />
  );

  return (
    <aside
      ref={panelRef}
      aria-label="Right panel"
      {...(fullscreen ? { "data-panel-fullscreen": "" } : {})}
      style={{ "--right-panel-width": `${width}px` } as CSSProperties}
      className={cn(
        "relative flex shrink-0 flex-col md:rounded-xl md:bg-sidebar md:shadow-1 md:ring-1 md:ring-sidebar-border",
        "transition-[width,opacity] duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
        // `!open` first, so a close collapses from fullscreen too.
        !open ? "w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none" : fullscreen ? "w-full max-w-none md:-ml-2" : "w-(--right-panel-width) max-w-[calc(100%-24rem)]",
      )}
    >
      {!fullscreen && <RightPanelResizeHandle panelRef={panelRef} />}
      <TabStrip {...props} browser={browser} launcher={launcher} actions={actions} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} />
      <div {...(tab ? { id: `right-panel-${tab}`, role: "tabpanel" } : {})} className="min-h-0 flex-1 overflow-y-auto md:rounded-b-xl">
        {/* A Terminal once shown stays mounted and hidden: remounting rebuilds every emulator and replays its bytes. */}
        {keptTerminals.map((id) => {
          const entry = tabs.find((candidate) => candidate.id === id);
          if (!entry) return null;
          const showing = entry.id === activeTab?.id;
          return (
            <div key={entry.id} className={cn("h-full", !showing && "hidden")}>
              <Suspense fallback={null}>{panelSurface(entry, showing)}</Suspense>
            </div>
          );
        })}
        {activeTab && keptTerminals.includes(activeTab.id) ? null : activeTab && (sessionId || model.browserTabId(activeTab.kind) === undefined) ? (
          <Suspense fallback={null}>
            {active && !model.ownsItsHeight(activeTab.kind) && <p className="px-4 pt-2 font-mono text-3xs uppercase tracking-[0.08em] text-muted-foreground/60">{active}</p>}
            {panelSurface(activeTab, true)}
          </Suspense>
        ) : (
          <PanelEmptyState rows={launcher} actions={actions} browserStart={browserStart} canOpenNew={onOpenNewTab !== undefined} />
        )}
        {activeTab && sessionId && (
          <Suspense fallback={null}>
            <ImageLightbox {...(lightbox ? { src: attachmentUrl(sessionId, lightbox, props.hostId ? { hostId: props.hostId } : {}) } : {})} onClose={() => setLightbox(undefined)} />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
