import { CircleDotIcon, FileCode2Icon, FileDiffIcon, FileIcon, GitPullRequestIcon, GlobeIcon, NotebookIcon, SmartphoneIcon, SquareTerminalIcon, TableIcon, type LucideIcon } from "lucide-react";
import type { CommandId } from "@/features/commands";
import type { BrowserProvider, BrowserTab } from "@telar/engine-client";
import { fileKind } from "@/features/files";
import { isPluginSurface, PLUGIN_SURFACES, pluginSurfaces, viewerAvailable, type PluginSurfaceId, type PluginPanelSource } from "@/features/plugins";
import type { PanelTabInstance, PanelTabParams } from "./tabs";

const SURFACES = [
  { id: "terminal", label: "Terminal", icon: SquareTerminalIcon, blurb: "Shells in this session's checkout, and what the project is running", key: "t", command: "open-terminal" },
  { id: "editor", label: "Editor", icon: FileCode2Icon, blurb: "Files, with the tree beside them", key: "e", command: "open-editor" },
  { id: "diff", label: "Diff", icon: FileDiffIcon, blurb: "What this session changed", key: "d", command: "open-diff" },
  { id: "simulator", label: "Simulator", icon: SmartphoneIcon, blurb: "This Mac's simulators, live and controllable", key: "s", command: "open-simulator" },
  { id: "issues", label: "Issues", icon: CircleDotIcon, blurb: "Open issues", key: "i", command: "open-issues" },
  { id: "pulls", label: "Pull requests", icon: GitPullRequestIcon, blurb: "Open pull requests", key: "u", command: "open-pulls" },
] as const;

type SurfaceId = (typeof SURFACES)[number]["id"] | PluginSurfaceId;

/** `key` is the launcher letter; `command` is the ⌘⇧ chord that opens the same surface from anywhere. */
type Surface = { id: SurfaceId; label: string; icon: LucideIcon; blurb: string; key?: string; command?: CommandId };

const ALL_SURFACES: readonly Surface[] = [...SURFACES, ...PLUGIN_SURFACES];

/** The launcher's Browser row: not a tab kind, since it starts the browser or shows the last page. */
export const BROWSER_SURFACE = { label: "Browser", icon: GlobeIcon, key: "b", command: "open-browser" } as const satisfies Omit<Surface, "id" | "blurb">;

export function surfaceCommands(enabledPlugins: readonly string[]): { command: CommandId; tab: PanelTab }[] {
  return surfacesFor(enabledPlugins).flatMap((surface) => (surface.command ? [{ command: surface.command, tab: surface.id as PanelTab }] : []));
}

export const NO_PLUGINS: readonly string[] = [];
export const NO_PANELS: readonly PluginPanelSource[] = [];

/** The surfaces a project offers: the core ones, then the enabled plugins'. */
function surfacesFor(enabledPlugins: readonly string[], pluginPanels: readonly PluginPanelSource[] = NO_PANELS): Surface[] {
  return [...SURFACES, ...pluginSurfaces(enabledPlugins, pluginPanels.length > 0)];
}

/** File, issue and pull ids are requests to open something inside a surface, never tabs of their own. */
export type PanelTab = SurfaceId | `browser:${string}` | `file:${string}` | `notebook:${string}` | `table:${string}` | `pdf:${string}` | `issue:${number}` | `pull:${number}`;

export type PanelTabItem = PanelTabInstance<PanelTab>;

export type BrowserState = { provider: BrowserProvider; tabs: BrowserTab[] };

export type LivePage = Pick<BrowserTab, "id" | "title" | "url"> & { active?: boolean };

export type TabDescription = { label: string; icon: LucideIcon; blurb: string; missing?: boolean };

const BROWSER_PREFIX = "browser:";
const FILE_PREFIX = "file:";
const NOTEBOOK_PREFIX = "notebook:";
const TABLE_PREFIX = "table:";
const PDF_PREFIX = "pdf:";
const ISSUE_PREFIX = "issue:";
const PULL_PREFIX = "pull:";
const FILE_TAB_PREFIXES = [FILE_PREFIX, NOTEBOOK_PREFIX, TABLE_PREFIX, PDF_PREFIX] as const;

const MULTI_INSTANCE: ReadonlySet<string> = new Set<string>(["editor", "diff", "terminal"]);

const suffixed = (prefix: string) => (tab: string) => (tab.startsWith(prefix) ? tab.slice(prefix.length) : undefined);

export const notebookPanelPath = suffixed(NOTEBOOK_PREFIX);
export const tablePanelPath = suffixed(TABLE_PREFIX);
export const pdfPanelPath = suffixed(PDF_PREFIX);
export const filePanelPath = suffixed(FILE_PREFIX);
export const browserTabId = suffixed(BROWSER_PREFIX);

/** The path behind a file-shaped tab id, or nothing for a surface. A path may contain a colon. */
export function filePanelTabPath(value: string): string | undefined {
  const prefix = FILE_TAB_PREFIXES.find((entry) => value.startsWith(entry) && value.length > entry.length);
  return prefix === undefined ? undefined : value.slice(prefix.length);
}

export function isFilePanelTab(value: string): boolean {
  return filePanelTabPath(value) !== undefined;
}

export function isRestorablePanelTab(value: string): value is PanelTab {
  return isPanelTab(value) && !isFilePanelTab(value) && issuePanelNumber(value) === undefined && pullPanelNumber(value) === undefined;
}

export function filePanelTab(path: string): PanelTab {
  return `${FILE_PREFIX}${path}`;
}

export function pdfPanelTab(path: string): PanelTab {
  return `${PDF_PREFIX}${path}`;
}

export function browserPanelTab(tabId: string): PanelTab {
  return `${BROWSER_PREFIX}${tabId}`;
}

export function issuePanelTab(number: number): PanelTab {
  return `${ISSUE_PREFIX}${number}`;
}

export function pullPanelTab(number: number): PanelTab {
  return `${PULL_PREFIX}${number}`;
}

/** A plugin's viewer only while that plugin is on; the PDF viewer is core. */
export function panelTabForPath(path: string, enabledPlugins: readonly string[]): PanelTab {
  const viewer = fileKind(path).viewer;
  if (!viewer || !viewerAvailable(viewer, enabledPlugins)) return filePanelTab(path);
  if (viewer === "notebook") return `${NOTEBOOK_PREFIX}${path}`;
  if (viewer === "table") return `${TABLE_PREFIX}${path}`;
  return pdfPanelTab(path);
}

export function editorInstanceKey(panelKey: string, instanceId: string): string {
  return instanceId === "editor" ? panelKey : `${panelKey}#${instanceId}`;
}

function forgeNumber(tab: string, prefix: string): number | undefined {
  if (!tab.startsWith(prefix)) return undefined;
  const digits = tab.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return undefined;
  const number = Number(digits);
  return number > 0 ? number : undefined;
}

export function issuePanelNumber(tab: string): number | undefined {
  return forgeNumber(tab, ISSUE_PREFIX);
}

export function pullPanelNumber(tab: string): number | undefined {
  return forgeNumber(tab, PULL_PREFIX);
}

/** Tabs whose surface renders `h-full` with its own chrome: a line above them costs their scroll, or a terminal's rows. */
export function ownsItsHeight(tab: PanelTab): boolean {
  return (
    browserTabId(tab) !== undefined ||
    filePanelPath(tab) !== undefined ||
    notebookPanelPath(tab) !== undefined ||
    tablePanelPath(tab) !== undefined ||
    pdfPanelPath(tab) !== undefined ||
    tab === "issues" ||
    tab === "pulls" ||
    tab === "editor" ||
    tab === "simulator" ||
    isPluginSurface(tab) ||
    tab === "terminal"
  );
}

/** Validates what comes back out of localStorage; a closed page or a deleted file is still a known tab. */
export function isPanelTab(value: string): value is PanelTab {
  if (value.startsWith(BROWSER_PREFIX)) return true;
  for (const prefix of FILE_TAB_PREFIXES) if (value.startsWith(prefix)) return value.length > prefix.length;
  if (value.startsWith(ISSUE_PREFIX)) return forgeNumber(value, ISSUE_PREFIX) !== undefined;
  if (value.startsWith(PULL_PREFIX)) return forgeNumber(value, PULL_PREFIX) !== undefined;
  return ALL_SURFACES.some((surface) => surface.id === value);
}

export function browserTabLabel(tab: Pick<BrowserTab, "title" | "url">): string {
  if (tab.title.trim()) return tab.title;
  try {
    return new URL(tab.url).host || tab.url;
  } catch {
    return tab.url || "Untitled page";
  }
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function describePanelTab(tab: PanelTab, browser?: BrowserState, live?: readonly LivePage[]): TabDescription {
  const path = filePanelPath(tab);
  if (path !== undefined) return { label: path.split("/").at(-1) || path, icon: FileIcon, blurb: path };
  const notebookPath = notebookPanelPath(tab);
  if (notebookPath !== undefined) return { label: basename(notebookPath), icon: NotebookIcon, blurb: notebookPath };
  const tablePath = tablePanelPath(tab);
  if (tablePath !== undefined) return { label: basename(tablePath), icon: TableIcon, blurb: tablePath };
  const pdfPath = pdfPanelPath(tab);
  if (pdfPath !== undefined) return { label: basename(pdfPath), icon: FileIcon, blurb: pdfPath };
  const issueNumber = issuePanelNumber(tab);
  if (issueNumber !== undefined) return { label: `#${issueNumber}`, icon: CircleDotIcon, blurb: `Issue #${issueNumber}` };
  const pullNumber = pullPanelNumber(tab);
  if (pullNumber !== undefined) return { label: `#${pullNumber}`, icon: GitPullRequestIcon, blurb: `Pull request #${pullNumber}` };
  const pageId = browserTabId(tab);
  if (pageId === undefined) {
    const surface = ALL_SURFACES.find((entry) => entry.id === tab)!;
    return { label: surface.label, icon: surface.icon, blurb: surface.blurb };
  }
  // The native browser's own list wins over the journal's, which lags or never names the native tab.
  const livePage = live?.find((entry) => entry.id === pageId);
  if (livePage) return { label: browserTabLabel(livePage), icon: GlobeIcon, blurb: livePage.url };
  const page = browser?.tabs.find((entry) => entry.id === pageId);
  if (!page) return { label: "Closed page", icon: GlobeIcon, blurb: "This page is no longer open.", missing: true };
  return { label: browserTabLabel(page), icon: GlobeIcon, blurb: page.url };
}

/** What tells two tabs of one kind apart: a basename, a host, or a filter. */
export function panelTabSuffix(params: PanelTabParams): string | undefined {
  const path = params.path;
  if (path) return basename(path) || path;
  const url = params.url;
  if (url) {
    try {
      return new URL(url).host || url;
    } catch {
      return url;
    }
  }
  return params.filter || undefined;
}

/** `terminal#3` is the third; the first instance's id is its bare kind. Shells have nothing else to tell them apart. */
function instanceOrdinal(id: string): string {
  const match = /#(\d+)$/.exec(id);
  return match ? match[1] : "1";
}

/** A `title` param names the tab outright; otherwise a suffix appears only while a sibling of the same kind is open. */
export function describePanelTabInstance(
  tab: PanelTabItem,
  options: { browser?: BrowserState; live?: readonly LivePage[]; duplicate?: boolean} = {},
): TabDescription {
  const base = describePanelTab(tab.kind, options.browser, options.live);
  const title = tab.params.title;
  const described = title ? { ...base, label: title, blurb: title } : base;
  if (!options.duplicate || title) return described;
  const suffix = panelTabSuffix(tab.params) ?? (tab.kind === "terminal" ? instanceOrdinal(tab.id) : undefined);
  if (!suffix) return described;
  return { ...described, label: `${described.label} · ${suffix}`, blurb: `${described.blurb} — ${suffix}` };
}

export type LauncherRow = { id: PanelTab | "browser"; label: string; icon: LucideIcon; key?: string; another: boolean; unavailable?: string };

/**
 * The launcher, shared by the empty panel and the "+": the Browser first when the cockpit can open one, then the surfaces.
 * A singleton already in the strip drops out; a multi-instance kind stays and opens another.
 */
export function launcherRows(
  tabs: readonly PanelTabItem[],
  { enabledPlugins, pluginPanels, canOpenNew, browser }: { enabledPlugins: readonly string[]; pluginPanels: readonly PluginPanelSource[]; canOpenNew: boolean; browser?: { unavailable?: string } },
): LauncherRow[] {
  const holdsKind = (kind: PanelTab) => tabs.some((entry) => entry.kind === kind);
  const offersAnother = (kind: PanelTab) => MULTI_INSTANCE.has(kind) && canOpenNew;
  const browserRow: LauncherRow[] = browser
    ? [{ id: "browser", label: BROWSER_SURFACE.label, icon: BROWSER_SURFACE.icon, key: BROWSER_SURFACE.key, another: false, ...(browser.unavailable ? { unavailable: browser.unavailable } : {}) }]
    : [];
  return [
    ...browserRow,
    ...surfacesFor(enabledPlugins, pluginPanels)
      .filter((surface) => !holdsKind(surface.id) || offersAnother(surface.id))
      .map((surface) => ({ id: surface.id as PanelTab, label: surface.label, icon: surface.icon, ...(surface.key ? { key: surface.key } : {}), another: holdsKind(surface.id) })),
  ];
}

export function launcherRowForKey(rows: readonly LauncherRow[], key: string): LauncherRow | undefined {
  const letter = key.toLowerCase();
  return rows.find((row) => row.key === letter && !row.unavailable);
}
