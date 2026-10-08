import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  activePanelTab,
  addPanelTab,
  closePanelTab,
  emptyPanelTabs,
  movePanelTab,
  nextPanelTabId,
  openNewPanelTab,
  openPanelTab,
  readPanelTabs,
  revealPanelTab,
  setPanelTabParams,
  writePanelTabs,
  type PanelTabInstance,
  type PanelTabState,
} from "./tabs";
import { browserPanelTab, browserTabId, browserTabLabel, describePanelTabInstance, isPanelTab, panelTabSuffix, type PanelTab } from "./model";

/** The strip as kinds, which is what every assertion below is actually about —
 *  ids are an implementation detail except where a test says otherwise. */
const kinds = <Kind extends string>(state: PanelTabState<Kind>) => state.tabs.map((tab) => tab.kind);
const ids = <Kind extends string>(state: PanelTabState<Kind>) => state.tabs.map((tab) => tab.id);

type Tab = "agents" | "changes" | "usage" | "editor" | `browser:${string}`;
const state = (tabs: Tab[], activeTab?: Tab, open = true): PanelTabState<Tab> => ({
  tabs: tabs.map((kind) => ({ id: kind, kind, params: {} })),
  ...(activeTab ? { activeTab } : {}),
  open,
});

describe("emptyPanelTabs", () => {
  test("starts closed with nothing selected", () => {
    // The whole point: arriving at a session must not decide what you look at.
    expect(emptyPanelTabs<Tab>()).toEqual({ tabs: [], open: false });
  });
});

describe("nextPanelTabId", () => {
  test("the FIRST instance of a kind takes the kind as its id", () => {
    // So everything keyed on "the Editor" keeps one key.
    expect(nextPanelTabId(emptyPanelTabs<Tab>(), "editor")).toBe("editor");
  });

  test("and every one after it is numbered from two", () => {
    const one = openPanelTab(emptyPanelTabs<Tab>(), "editor");
    const two = openNewPanelTab(one, "editor");
    expect(nextPanelTabId(two, "editor")).toBe("editor#3");
    expect(ids(two)).toEqual(["editor", "editor#2"]);
  });
});

describe("openPanelTab", () => {
  test("opens the panel and selects the tab", () => {
    const opened = openPanelTab(emptyPanelTabs<Tab>(), "changes");
    expect(kinds(opened)).toEqual(["changes"]);
    expect(opened.activeTab).toBe("changes");
    expect(opened.open).toBe(true);
  });

  test("reopening FOCUSES rather than duplicating — a kind is opened once by this verb", () => {
    const opened = openPanelTab(openPanelTab(emptyPanelTabs<Tab>(), "agents"), "changes");
    const again = openPanelTab(opened, "agents");
    expect(kinds(again)).toEqual(["agents", "changes"]);
    expect(again.activeTab).toBe("agents");
  });

  test("with two of a kind open it focuses the one you are already looking at", () => {
    // Clicking a file while reading the second Editor must open it there, not
    // jump the strip back to the first.
    const two = openNewPanelTab(openPanelTab(emptyPanelTabs<Tab>(), "editor"), "editor");
    expect(two.activeTab).toBe("editor#2");
    expect(openPanelTab(two, "editor").activeTab).toBe("editor#2");
    // …and from somewhere else entirely, the leftmost of the kind.
    const elsewhere = openPanelTab(two, "agents");
    expect(openPanelTab(elsewhere, "editor").activeTab).toBe("editor");
  });

  test("reopens the panel when it was closed but still holds tabs", () => {
    expect(openPanelTab(state(["agents"], "agents", false), "agents").open).toBe(true);
  });
});

describe("openNewPanelTab", () => {
  test("opens a SECOND instance of a kind and focuses it", () => {
    // #322: an Editor holds the files you opened and a Browser the pages you
    // navigated to, so a second one is a different thing rather than a copy.
    const two = openNewPanelTab(openPanelTab(emptyPanelTabs<Tab>(), "editor"), "editor");
    expect(kinds(two)).toEqual(["editor", "editor"]);
    expect(ids(two)).toEqual(["editor", "editor#2"]);
    expect(two.activeTab).toBe("editor#2");
  });

  test("closing one leaves the other, with its own params", () => {
    let panel = openPanelTab(emptyPanelTabs<Tab>(), "editor");
    panel = setPanelTabParams(panel, "editor", { path: "src/a.ts" });
    panel = addPanelTab(panel, { id: "editor#2", kind: "editor", params: { path: "src/b.ts" } });
    const left = closePanelTab(panel, "editor");
    expect(left.tabs).toEqual([{ id: "editor#2", kind: "editor", params: { path: "src/b.ts" } }]);
    expect(left.activeTab).toBe("editor#2");
  });
});

describe("setPanelTabParams", () => {
  test("replaces an instance's params, and is identity when nothing changed", () => {
    const panel = openPanelTab(emptyPanelTabs<Tab>(), "editor");
    const named = setPanelTabParams(panel, "editor", { path: "README.md" });
    expect(named.tabs[0]!.params).toEqual({ path: "README.md" });
    // Identity matters: the cockpit syncs these on every Editor change and
    // writes to localStorage only when the strip actually moved.
    expect(setPanelTabParams(named, "editor", { path: "README.md" })).toBe(named);
    expect(setPanelTabParams(named, "editor#9", { path: "x" })).toBe(named);
    // A REPLACE, not a merge — a key nobody could clear would be worse.
    expect(setPanelTabParams(named, "editor", {}).tabs[0]!.params).toEqual({});
  });

  test("a partial write erases the keys it did not mention — which is why the Diff writes its whole tab", () => {
    /**
     * THE HAZARD THE REPLACE CREATES, pinned as behaviour rather than left as
     * a sentence in a comment. The Diff tab carries a filter AND a scope AND a
     * remembered base (#694, #335); a handler writing one of them would erase
     * the others, silently, and only for somebody who had touched both.
     * `diffTabParams` exists so there is one writer for the whole set.
     */
    const panel = addPanelTab(emptyPanelTabs<Tab>(), { id: "diff", kind: "diff", params: { scope: "branch", base: "origin/main", filter: "apps/web" } });
    expect(setPanelTabParams(panel, "diff", { filter: "apps/engine" }).tabs[0]!.params).toEqual({ filter: "apps/engine" });
  });

  test("two panels on one session keep their own params", () => {
    /**
     * WHY THE DIFF'S SCOPE LIVES HERE AT ALL. Each window holds its own
     * `PanelTabState`, which is what lets one show the working tree while the
     * other shows a turn — the same property #693 relies on for "one issue
     * here, another one there" after detail tabs moved inside their list.
     */
    const base = addPanelTab(emptyPanelTabs<Tab>(), { id: "diff", kind: "diff", params: {} });
    const left = setPanelTabParams(base, "diff", { scope: "turn", turn: "run_7" });
    const right = setPanelTabParams(base, "diff", { scope: "branch", base: "origin/main" });
    expect(left.tabs[0]!.params).toEqual({ scope: "turn", turn: "run_7" });
    expect(right.tabs[0]!.params).toEqual({ scope: "branch", base: "origin/main" });
    // ...and neither write reached the state the other was made from.
    expect(base.tabs[0]!.params).toEqual({});
  });
});

describe("closePanelTab", () => {
  test("focus moves to the tab on the right", () => {
    const next = closePanelTab(state(["agents", "changes", "usage"], "changes"), "changes");
    expect(kinds(next)).toEqual(["agents", "usage"]);
    expect(next.activeTab).toBe("usage");
  });

  test("closing the rightmost tab falls back to the new last one", () => {
    const next = closePanelTab(state(["agents", "changes"], "changes"), "changes");
    expect(next.activeTab).toBe("agents");
  });

  test("closing an inactive tab does not steal focus", () => {
    const next = closePanelTab(state(["agents", "changes", "usage"], "usage"), "agents");
    expect(next.activeTab).toBe("usage");
  });

  test("closing the last tab leaves the panel open on its empty state", () => {
    // Open with no tabs is the "choose a surface" screen — not the same as shut.
    const next = closePanelTab(state(["agents"], "agents"), "agents");
    expect(next).toEqual({ tabs: [], open: true });
  });

  test("closing a tab that is not open changes nothing", () => {
    const before = state(["agents"], "agents");
    expect(closePanelTab(before, "usage")).toBe(before);
  });
});

describe("browser pages are their own tabs", () => {
  test("a page id round-trips through its panel tab id", () => {
    const tab = browserPanelTab("tab_7");
    expect(tab).toBe("browser:tab_7");
    expect(browserTabId(tab)).toBe("tab_7");
  });

  test("a fixed surface reports no page id", () => {
    expect(browserTabId("agents")).toBeUndefined();
  });

  test("two pages are two independent tabs", () => {
    // The whole point of the change: opening a second page must not replace the
    // first, and closing one must leave the other alone.
    const one = openPanelTab(emptyPanelTabs<Tab>(), browserPanelTab("a"));
    const two = openPanelTab(one, browserPanelTab("b"));
    expect(kinds(two)).toEqual(["browser:a", "browser:b"]);
    expect(kinds(closePanelTab(two, browserPanelTab("a")))).toEqual(["browser:b"]);
  });

  test("a stored browser tab survives a reload even for a page that has since closed", () => {
    // `isPanelTab` answers a question about SHAPE, so a page the engine no
    // longer reports is still a tab you opened — the surface says it is gone
    // rather than the tab silently vanishing on restore.
    expect(isPanelTab("browser:whatever")).toBe(true);
    expect(isPanelTab("diff")).toBe(true);
    expect(isPanelTab("not-a-tab")).toBe(false);
  });
});

describe("browserTabLabel", () => {
  test("prefers the title", () => {
    expect(browserTabLabel({ title: "Management", url: "http://127.0.0.1:8317/management.html" })).toBe("Management");
  });

  test("falls back to the host, not the whole URL", () => {
    // Two tabs on the same site would otherwise be indistinguishable at the
    // width a tab actually has.
    expect(browserTabLabel({ title: "", url: "http://100.72.141.10:8317/management.html" })).toBe("100.72.141.10:8317");
  });

  test("falls back to the raw string when the URL will not parse", () => {
    expect(browserTabLabel({ title: "", url: "about:blank" })).toBe("about:blank");
    expect(browserTabLabel({ title: "", url: "" })).toBe("Untitled page");
  });
});

describe("the suffix that tells two tabs of a kind apart", () => {
  test("a file is its basename, a URL is its host, a filter is itself", () => {
    expect(panelTabSuffix({ path: "apps/web/src/components/right-panel.tsx" })).toBe("right-panel.tsx");
    expect(panelTabSuffix({ url: "http://localhost:3000/a/b?c=d" })).toBe("localhost:3000");
    expect(panelTabSuffix({ filter: "apps/web" })).toBe("apps/web");
    expect(panelTabSuffix({})).toBeUndefined();
  });

  test("an unparseable URL is shown as written rather than dropped", () => {
    expect(panelTabSuffix({ url: "not a url" })).toBe("not a url");
  });

  test("ONE of a kind wears no suffix; the label is already unambiguous", () => {
    const only = describePanelTabInstance({ id: "editor", kind: "editor", params: { path: "README.md" } });
    expect(only.label).toBe("Editor");
  });

  test("two of a kind both wear theirs", () => {
    const first = describePanelTabInstance({ id: "editor", kind: "editor", params: { path: "README.md" } }, { duplicate: true });
    const second = describePanelTabInstance({ id: "editor#2", kind: "editor", params: { path: "apps/web/src/lib/utils.ts" } }, { duplicate: true });
    expect(first.label).toBe("Editor · README.md");
    expect(second.label).toBe("Editor · utils.ts");
  });

  test("an editor with nothing to say keeps its bare label; shells are told apart by ordinal", () => {
    expect(describePanelTabInstance({ id: "editor#2", kind: "editor", params: {} }, { duplicate: true }).label).toBe("Editor");
    expect(describePanelTabInstance({ id: "terminal", kind: "terminal", params: {} }, { duplicate: true }).label).toBe("Terminal · 1");
    expect(describePanelTabInstance({ id: "terminal#2", kind: "terminal", params: {} }, { duplicate: true }).label).toBe("Terminal · 2");
  });

  test("a title param names the tab outright, sibling or not", () => {
    expect(describePanelTabInstance({ id: "terminal#2", kind: "terminal", params: { title: "vim" } }, { duplicate: true }).label).toBe("vim");
    expect(describePanelTabInstance({ id: "terminal", kind: "terminal", params: { title: "vim" } }).label).toBe("vim");
  });
});

describe("movePanelTab", () => {
  const strip: PanelTabState<PanelTab> = {
    tabs: [
      { id: "issues", kind: "issues", params: {} },
      { id: "diff", kind: "diff", params: {} },
      { id: "terminal", kind: "terminal", params: {} },
    ],
    activeTab: "diff",
    open: true,
  };

  test("`toIndex` is where the tab lands in the strip once it has left its old place", () => {
    expect(kinds(movePanelTab(strip, "issues", 2))).toEqual(["diff", "terminal", "issues"]);
    expect(kinds(movePanelTab(strip, "terminal", 0))).toEqual(["terminal", "issues", "diff"]);
    expect(kinds(movePanelTab(strip, "issues", 1))).toEqual(["diff", "issues", "terminal"]);
  });

  test("past either end means that end, because that is what the pointer said", () => {
    expect(kinds(movePanelTab(strip, "issues", 99))).toEqual(["diff", "terminal", "issues"]);
    expect(kinds(movePanelTab(strip, "terminal", -4))).toEqual(["terminal", "issues", "diff"]);
  });

  test("a move to where it already is, or of a tab that is not open, changes nothing", () => {
    expect(movePanelTab(strip, "issues", 0)).toBe(strip);
    expect(movePanelTab(strip, "agents", 0)).toBe(strip);
  });

  test("neither the active tab nor the panel's openness moves with it", () => {
    // Reordering says where a tab SITS. A strip that also switched what you
    // were reading would be answering a question nobody asked.
    const out = movePanelTab(strip, "terminal", 0);
    expect(out.activeTab).toBe("diff");
    expect(out.open).toBe(true);
  });

  test("it moves ONE instance, not every tab of its kind", () => {
    let panel = openPanelTab(emptyPanelTabs<Tab>(), "editor");
    panel = openPanelTab(panel, "agents");
    panel = openNewPanelTab(panel, "editor");
    expect(ids(panel)).toEqual(["editor", "agents", "editor#2"]);
    expect(ids(movePanelTab(panel, "editor#2", 0))).toEqual(["editor#2", "editor", "agents"]);
  });
});

/**
 * A `window` WITH A STORE, INSTALLED AND TAKEN AWAY AGAIN.
 *
 * The whole suite shares one process and one `globalThis`, and several modules
 * branch on `typeof window === "undefined"` to decide they are on the server —
 * `lib/composer-draft.ts` dispatches a DOM event when it decides they are not.
 * So a `window` left behind here is not tidiness, it is other files failing:
 * these tests are the only ones that want one, and they hand it back.
 */
function storeWindow(): unknown {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

const isKnown = (kind: string): kind is PanelTab => isPanelTab(kind);

describe("persistence", () => {
  let previous: unknown;
  beforeEach(() => {
    previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = storeWindow();
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = previous;
  });

describe("round-trips instances", () => {
  test("two Editors come back as two Editors, with their params and their order", () => {
    let panel = openPanelTab(emptyPanelTabs<PanelTab>(), "editor");
    panel = setPanelTabParams(panel, "editor", { path: "src/a.ts" });
    panel = openNewPanelTab(panel, "editor", { path: "src/b.ts" });
    writePanelTabs("session_a", panel, 1);
    const restored = readPanelTabs<PanelTab>("session_a", isKnown);
    expect(restored.tabs).toEqual([
      { id: "editor", kind: "editor", params: { path: "src/a.ts" } },
      { id: "editor#2", kind: "editor", params: { path: "src/b.ts" } },
    ]);
    expect(restored.activeTab).toBe("editor#2");
    expect(activePanelTab(restored)?.params).toEqual({ path: "src/b.ts" });
  });

  test("two Diffs come back under their own filters, which is what keeps them two tabs (#335)", () => {
    // The filter IS the instance here: persisted with the arrangement, read
    // back by the surface, and read by `panelTabSuffix` for the label.
    let panel = openPanelTab(emptyPanelTabs<PanelTab>(), "diff");
    panel = setPanelTabParams(panel, "diff", { filter: "apps/web" });
    panel = openNewPanelTab(panel, "diff", { filter: "apps/engine" });
    writePanelTabs("session_a", panel, 1);
    const restored = readPanelTabs<PanelTab>("session_a", isKnown);
    expect(restored.tabs).toEqual([
      { id: "diff", kind: "diff", params: { filter: "apps/web" } },
      { id: "diff#2", kind: "diff", params: { filter: "apps/engine" } },
    ]);
    expect(restored.tabs.map((entry) => describePanelTabInstance(entry, { duplicate: true }).label)).toEqual(["Diff · apps/web", "Diff · apps/engine"]);
  });

  test("a cleared filter is an absent param, so the tab goes back to reading Diff", () => {
    let panel = openPanelTab(emptyPanelTabs<PanelTab>(), "diff");
    panel = setPanelTabParams(panel, "diff", { filter: "apps/web" });
    // What the surface's empty field sends: the whole params replaced, not a
    // blank string left behind for the label to draw a separator after.
    panel = setPanelTabParams(panel, "diff", {});
    writePanelTabs("session_a", panel, 1);
    const restored = readPanelTabs<PanelTab>("session_a", isKnown);
    expect(restored.tabs).toEqual([{ id: "diff", kind: "diff", params: {} }]);
    expect(describePanelTabInstance(restored.tabs[0]!).label).toBe("Diff");
  });

  test("a stored instance whose kind this build dropped goes, and its siblings stay", () => {
    writePanelTabs(
      "session_a",
      {
        tabs: [
          { id: "usage", kind: "usage" as PanelTab, params: {} },
          { id: "agents", kind: "agents" as PanelTab, params: {} },
          { id: "diff", kind: "diff", params: {} },
          { id: "processes", kind: "processes" as PanelTab, params: {} },
        ],
        activeTab: "agents",
        open: true,
      },
      1,
    );
    const restored = readPanelTabs<PanelTab>("session_a", isKnown);
    expect(kinds(restored)).toEqual(["diff"]);
    // The active tab went with it, so focus falls to what is left.
    expect(restored.activeTab).toBe("diff");
  });
});
});

describe("revealPanelTab", () => {
  const browser: PanelTabInstance = { id: "browser", kind: "browser", params: {} };
  const diff: PanelTabInstance = { id: "diff", kind: "diff", params: {} };

  test("an agent's item is added to the strip and NEVER selected, in every panel state", () => {
    // The panel's focus is the person's alone: closed, open on another tab, or
    // empty — the active tab and the panel's visibility come out as they went in.
    const cases: PanelTabState<string>[] = [
      { tabs: [diff], activeTab: "diff", open: false },
      { tabs: [diff], activeTab: "diff", open: true },
      { tabs: [], open: true },
      { tabs: [], open: false },
    ];
    for (const state of cases) {
      const next = revealPanelTab(state, browser);
      expect(next.tabs.map((tab) => tab.id)).toEqual([...state.tabs.map((tab) => tab.id), "browser"]);
      expect(next.activeTab).toBe(state.activeTab);
      expect(next.open).toBe(state.open);
    }
  });

  test("a tab that is already there is left alone, selected or not", () => {
    const state: PanelTabState<string> = { tabs: [browser, diff], activeTab: "diff", open: false };
    expect(revealPanelTab(state, browser)).toBe(state);
  });

  test("is the same object when there is nothing to change", () => {
    const watching: PanelTabState<string> = { tabs: [browser, diff], activeTab: "diff", open: true };
    expect(revealPanelTab(watching, browser)).toBe(watching);
    const already: PanelTabState<string> = { tabs: [browser], activeTab: "browser", open: false };
    expect(revealPanelTab(already, browser)).toBe(already);
  });
});
