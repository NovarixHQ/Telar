import { describe, expect, test } from "bun:test";
import { inlineCompletion, looksLikeAddress, rankSuggestions, type AddressSuggestion } from "./address-suggestions";
import type { BrowserHistoryEntry, DesktopBrowserTab } from "./types";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const page = (url: string, patch: Partial<BrowserHistoryEntry> = {}): BrowserHistoryEntry => ({ url, title: "", visits: 1, lastVisit: NOW - DAY, ...patch });
const tab = (index: number, url: string, patch: Partial<DesktopBrowserTab> = {}): DesktopBrowserTab => ({
  index, id: `tab_${index}`, title: "", url, active: false, loading: false, canGoBack: false, canGoForward: false, ...patch,
});

const urls = (rows: AddressSuggestion[]) => rows.flatMap((row) => (row.kind === "typed" ? [] : [row.url]));
const rank = (text: string, history: BrowserHistoryEntry[], tabs: DesktopBrowserTab[] = []) => rankSuggestions(text, { history, tabs, now: NOW });

describe("rankSuggestions", () => {
  test("a host prefix outranks a title match, however often the title's page was visited", () => {
    const rows = rank("git", [page("https://docs.example/guide", { title: "Git handbook", visits: 90, lastVisit: NOW }), page("https://github.com/")]);
    expect(urls(rows)).toEqual(["https://github.com/", "https://docs.example/guide"]);
  });

  test("a localhost dev server ranks by host prefix and by its port", () => {
    const history = [page("https://localhost.example/"), page("http://localhost:3000/", { visits: 4 }), page("https://news.example/", { title: "3000 things" })];
    expect(urls(rank("localhost:3", history))).toEqual(["http://localhost:3000/"]);
    expect(urls(rank("30", history))[0]).toBe("http://localhost:3000/");
    expect(inlineCompletion("localhost:3", rank("localhost:3", history))).toBe("000");
  });

  test("among equal matches the more recent and more frequent page comes first", () => {
    const old = page("https://example.com/old", { lastVisit: NOW - 60 * DAY });
    const recent = page("https://example.com/new", { lastVisit: NOW - DAY });
    expect(urls(rank("example.com/", [old, recent]))).toEqual(["https://example.com/new", "https://example.com/old"]);
    const frequent = page("https://example.com/often", { visits: 30, lastVisit: NOW - 60 * DAY });
    expect(urls(rank("example.com/", [old, frequent]))[0]).toBe("https://example.com/often");
  });

  test("an open tab replaces its own history row and the active tab is never suggested", () => {
    const rows = rank("app", [page("https://app.example/inbox")], [tab(0, "https://app.example/", { active: true }), tab(1, "https://app.example/inbox?x=1", { title: "Inbox" })]);
    expect(rows.filter((row) => row.kind !== "typed")).toEqual([{ kind: "tab", url: "https://app.example/inbox?x=1", title: "Inbox", index: 1, completion: ".example", favicon: undefined }]);
  });

  test("the typed text is always the last row, as a search unless it reads as an address", () => {
    expect(rank("cats and dogs", []).at(-1)).toEqual({ kind: "typed", text: "cats and dogs", search: true });
    expect(rank("localhost:5173", []).at(-1)).toEqual({ kind: "typed", text: "localhost:5173", search: false });
    expect(rank("  ", [page("https://example.com/")])).toEqual([]);
  });
});

describe("inlineCompletion", () => {
  test("completes the top host, then the full page once the host is typed", () => {
    const history = [page("https://www.github.com/telar/issues", { visits: 3 })];
    expect(inlineCompletion("gi", rank("gi", history))).toBe("thub.com");
    expect(inlineCompletion("github.com/te", rank("github.com/te", history))).toBe("lar/issues");
    expect(inlineCompletion("https://www.git", rank("https://www.git", history))).toBe("hub.com");
  });

  test("offers nothing for a title match or text with spaces", () => {
    const history = [page("https://docs.example/", { title: "Git handbook" })];
    expect(inlineCompletion("git", rank("git", history))).toBe("");
    expect(inlineCompletion("docs ", rank("docs ", history))).toBe("");
  });
});

test("looksLikeAddress matches the shell's address test", () => {
  expect(["example.com", "localhost:3000/x", "127.0.0.1", "https://a", "/tmp/file.html"].every(looksLikeAddress)).toBe(true);
  expect(["cats", "two words.com", ""].some(looksLikeAddress)).toBe(false);
});
