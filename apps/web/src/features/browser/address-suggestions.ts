import type { BrowserHistoryEntry, DesktopBrowserTab } from "./types";

export type AddressSuggestion =
  | { kind: "tab" | "history"; url: string; title: string; favicon?: string | null; index?: number; completion?: string }
  | { kind: "typed"; text: string; search: boolean };

const DAY_MS = 86_400_000;
const MAX_ROWS = 6;
const IP_HOST = /^(\d{1,3}(?:\.\d{1,3}){3}|\[[\da-fA-F:]+\])$/;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function looksLikeAddress(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith("/") || /^[a-z][a-z\d+.-]*:\/\//i.test(text)) return true;
  if (/\s/.test(text)) return false;
  if (text.includes(".")) return true;
  const host = text.split(/[/?#]/, 1)[0].replace(/:\d+$/, "");
  return host === "localhost" || IP_HOST.test(host);
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^([^/?#]+)\/$/, "$1");
}

function parsed(url: string): URL | undefined {
  try { return new URL(url); } catch { return undefined; }
}

const pageKey = (url: string) => { const page = parsed(url); return page ? page.origin + page.pathname : url; };

function hostEnd(target: string, from = 0): number {
  const at = target.slice(from).search(/[/?#]/);
  return at < 0 ? target.length : from + at;
}

function completionFrom(target: string, typed: string, hostLength: number): string | undefined {
  const end = typed.length < hostLength ? hostLength : target.length;
  return target.slice(typed.length, end) || undefined;
}

type Match = { tier: number; completion?: string };

function match(url: string, title: string, query: string): Match | undefined {
  const shown = displayUrl(url);
  const host = shown.slice(0, hostEnd(shown)).toLowerCase();
  const full = url.replace(/\/$/, "");
  if (shown.toLowerCase().startsWith(query)) return { tier: 3000, completion: completionFrom(shown, query, host.length) };
  if (full.toLowerCase().startsWith(query)) return { tier: 3000, completion: completionFrom(full, query, hostEnd(full, full.indexOf("//") + 2)) };
  const [name, port] = host.split(":");
  if (port && LOOPBACK.test(name) && port.startsWith(query)) return { tier: 2500 };
  if (host.split(/[.:]/).some((label) => label.startsWith(query))) return { tier: 2000 };
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.split(/\W+/).some((word) => word && word.startsWith(query))) return { tier: 1500 };
  if (lowerTitle.includes(query)) return { tier: 1000 };
  if (shown.toLowerCase().includes(query)) return { tier: 500 };
  return undefined;
}

function frecency(visits: number, lastVisit: number, now: number): number {
  const ageDays = Math.max(0, now - lastVisit) / DAY_MS;
  return Math.log2(1 + Math.min(visits, 100)) * 40 + 200 / (1 + ageDays);
}

type Sources = { history: readonly BrowserHistoryEntry[]; tabs: readonly DesktopBrowserTab[]; now: number };

export function rankSuggestions(text: string, { history, tabs, now }: Sources): AddressSuggestion[] {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  const favicons = new Map<string, string>();
  for (const tab of tabs) if (tab.favicon) favicons.set(parsed(tab.url)?.origin ?? "", tab.favicon);
  const faviconOf = (url: string) => favicons.get(parsed(url)?.origin ?? "") ?? null;
  const openTabs = tabs.filter((tab) => !tab.active && /^https?:/i.test(tab.url));
  const openPages = new Set(openTabs.map((tab) => pageKey(tab.url)));
  const scored: { row: AddressSuggestion; score: number }[] = [];
  for (const tab of openTabs) {
    const found = match(tab.url, tab.title, query);
    if (found) scored.push({ row: { kind: "tab", url: tab.url, title: tab.title, favicon: tab.favicon, index: tab.index, completion: found.completion }, score: found.tier + frecency(1, now, now) - displayUrl(tab.url).length / 100 });
  }
  for (const entry of history) {
    if (openPages.has(pageKey(entry.url))) continue;
    const found = match(entry.url, entry.title, query);
    if (found) scored.push({ row: { kind: "history", url: entry.url, title: entry.title, favicon: faviconOf(entry.url), completion: found.completion }, score: found.tier + frecency(entry.visits, entry.lastVisit, now) - displayUrl(entry.url).length / 100 });
  }
  scored.sort((a, b) => b.score - a.score);
  const typed = text.trim();
  return [...scored.slice(0, MAX_ROWS).map(({ row }) => row), { kind: "typed", text: typed, search: !looksLikeAddress(typed) }];
}

export function inlineCompletion(text: string, rows: readonly AddressSuggestion[]): string {
  const top = rows[0];
  if (/\s/.test(text) || !top || top.kind === "typed") return "";
  return top.completion ?? "";
}
