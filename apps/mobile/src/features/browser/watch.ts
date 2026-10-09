import type { BrowserSnapshot, BrowserTab } from "@telar/engine-client";

export type BrowserView = {
  snapshot?: Omit<BrowserSnapshot, "screenshot">;
  image?: { pageId: string; uri: string };
  failure?: string;
};

export const pageLabel = (page: BrowserTab) => {
  if (page.title) return page.title;
  if (!page.url) return "New page";
  return page.url.match(/^[a-z]+:\/\/([^/?#]+)/i)?.[1] ?? page.url;
};

export const addressUrl = (typed: string) => {
  const trimmed = typed.trim();
  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
};

/** The page to show: the one asked for while it is open, else the one with focus, else the first. */
export const pickPage = (pages: readonly BrowserTab[], wanted: string | undefined) => pages.find((page) => page.id === wanted) ?? pages.find((page) => page.active) ?? pages[0];

export function pageNotice(view: BrowserView, page: BrowserTab | undefined): string {
  if (view.failure) return view.failure;
  if (!page) return "The agent closed it, or the session ended.";
  if (!view.snapshot?.running) return "The browser is not running.";
  if (!page.active) return "Only the page with focus can be photographed.";
  return "Waiting for the first screenshot.";
}

/** One session's browser as read from the engine; a read that changes nothing notifies nobody. */
export class BrowserWatch {
  private view: BrowserView = {};
  private readonly listeners = new Set<() => void>();

  state = () => this.view;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Takes a read and returns the page an open created: the newest unknown one, else the one with focus. */
  absorb(read: BrowserSnapshot, known: ReadonlySet<string> = new Set()): BrowserTab | undefined {
    const { screenshot, ...bare } = read;
    const focused = read.tabs.find((page) => page.active);
    let next = this.view;
    if (JSON.stringify(bare) !== JSON.stringify(next.snapshot)) next = { ...next, snapshot: bare };
    if ((read.error ?? undefined) !== next.failure) next = { ...next, failure: read.error };
    if (screenshot && focused && (screenshot !== next.image?.uri || focused.id !== next.image.pageId)) next = { ...next, image: { pageId: focused.id, uri: screenshot } };
    this.commit(next);
    return read.tabs.findLast((page) => !known.has(page.id)) ?? focused;
  }

  fail(error: unknown) {
    const failure = error instanceof Error ? error.message : String(error);
    if (failure !== this.view.failure) this.commit({ ...this.view, failure });
  }

  private commit(next: BrowserView) {
    if (next === this.view) return;
    this.view = next;
    this.listeners.forEach((listener) => listener());
  }
}
