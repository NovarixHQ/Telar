import type { DesktopBrowserBridge } from "./types";

const closing = new Map<string, Promise<void>>();
const closingPages = new Map<string, Set<string>>();

export function isClosingPage(scopeKey: string, pageId: string): boolean {
  return closingPages.get(scopeKey)?.has(pageId) ?? false;
}

/**
 * Close one page of a native browser by id; closing its last page releases the scope as the person's close.
 * Queued per scope: the shell closes by index, and every close renumbers the pages after it.
 */
export function closeNativePage(bridge: DesktopBrowserBridge, scopeKey: string, pageId: string): Promise<void> {
  const pages = closingPages.get(scopeKey) ?? new Set<string>();
  closingPages.set(scopeKey, pages.add(pageId));
  const run = (closing.get(scopeKey) ?? Promise.resolve())
    .then(async () => {
      const { tabs } = await bridge.getState(scopeKey);
      const page = tabs.find((tab) => tab.id === pageId);
      if (!page) return;
      if (tabs.length === 1 && bridge.releaseScope) await bridge.releaseScope(scopeKey, true, { closedByPerson: true });
      else await bridge.action(scopeKey, { action: "close", index: page.index });
    })
    .catch(() => undefined);
  closing.set(scopeKey, run);
  void run.then(() => {
    if (closing.get(scopeKey) === run) closing.delete(scopeKey);
    pages.delete(pageId);
    if (pages.size === 0 && closingPages.get(scopeKey) === pages) closingPages.delete(scopeKey);
  });
  return run;
}

/** The page "open the browser" shows: the active one, else the last. */
export async function nativePageToShow(bridge: DesktopBrowserBridge, scopeKey: string): Promise<string | undefined> {
  const tabs = await bridge.getState(scopeKey).then((state) => state.tabs, () => []);
  return (tabs.find((tab) => tab.active) ?? tabs.at(-1))?.id;
}

export async function openNativePage(bridge: DesktopBrowserBridge, scopeKey: string): Promise<string | undefined> {
  const { tabs } = await bridge.getState(scopeKey).catch(() => ({ tabs: [] }));
  if (tabs.length === 0) return undefined;
  const next = await bridge.action(scopeKey, { action: "new" });
  return (next.tabs.find((tab) => tab.active) ?? next.tabs.at(-1))?.id;
}
