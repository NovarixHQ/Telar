import { describe, expect, test } from "bun:test";
import { setPluginStatuses } from "@/features/plugins";
import { DATA_SCIENCE_STATUS } from "@/test/plugin-statuses";
import { defaultKeymap, resolveCommandForEvent } from "@/features/commands";
import {
  BROWSER_SURFACE,
  launcherRowForKey,
  launcherRows,
  surfaceCommands,
  browserPanelTab,
  describePanelTab,
  filePanelTabPath,
  isFilePanelTab,
  isPanelTab,
  isRestorablePanelTab,
  issuePanelNumber,
  issuePanelTab,
  panelTabForPath,
  pdfPanelPath,
  pdfPanelTab,
  pullPanelNumber,
  pullPanelTab,
  type PanelTab,
} from "./model";
import { emptyPanelTabs, openPanelTab } from "./tabs";

describe("file tabs", () => {
  test("a bare `file:` is not a tab", () => {
    // It names nothing, so restoring it from localStorage would produce a tab
    // that can only ever fail to load.
    expect(isPanelTab("file:src/a.ts")).toBe(true);
    expect(isPanelTab("file:")).toBe(false);
    // And the renamed surfaces are what this build understands.
    expect(isPanelTab("diff")).toBe(true);
    expect(isPanelTab("changes")).toBe(false);
    expect(isPanelTab("git")).toBe(false);
    expect(isPanelTab("files")).toBe(false);
  });
});

describe("the Run surface, which is now the Terminal's strip (#890)", () => {
  test("`run` is no longer a tab kind at all", () => {
    // Run and Terminal were two surfaces for one idea, each with its own
    // emulator drawing the same kind of bytes. A run is a CHIP now; leaving the
    // kind valid would let a saved layout restore a pane nothing renders.
    expect(isPanelTab("run")).toBe(false);
  });
});

describe("the Terminal surface", () => {
  test("is a real tab: it validates, it survives a restore, and it is not file-shaped", () => {
    // The panel restores tab ids from storage, so a surface that does not
    // validate here is one that silently disappears on the next reload — and
    // with it the id of a shell that is still running.
    expect(isPanelTab("terminal")).toBe(true);
    expect(isFilePanelTab("terminal")).toBe(false);
  });

  test("describes itself with no session and no shell", () => {
    const { label, blurb } = describePanelTab("terminal");
    expect(label).toBe("Terminal");
    expect(blurb.length).toBeGreaterThan(0);
  });

  test("asking for a terminal twice focuses the one you have", () => {
    let state = openPanelTab(emptyPanelTabs<PanelTab>(), "terminal");
    state = openPanelTab(state, "terminal");
    expect(state.tabs.map((entry) => entry.id)).toEqual(["terminal"]);
    expect(state.activeTab).toBe("terminal");
  });
});

describe("pdf tabs", () => {
  test("a .pdf path routes to its own tab, data science or not", () => {
    // The PDF viewer is deliberately ungated: compiled LaTeX output, a
    // downloaded paper — a document renders wherever it is opened from.
    expect(panelTabForPath("docs/paper.pdf", [])).toBe("pdf:docs/paper.pdf");
    expect(panelTabForPath("docs/paper.pdf", ["data-science"])).toBe("pdf:docs/paper.pdf");
    // While the data-science pair keeps its gate.
    expect(panelTabForPath("analysis.ipynb", [])).toBe("file:analysis.ipynb");
    setPluginStatuses([DATA_SCIENCE_STATUS]);
    expect(panelTabForPath("analysis.ipynb", ["data-science"])).toBe("view:analysis.ipynb");
    // And markdown stays a `file:` tab — the file view renders it itself.
    expect(panelTabForPath("README.md", [])).toBe("file:README.md");
  });

  test("the tab round-trips, validates, and counts as an open file", () => {
    expect(pdfPanelPath(pdfPanelTab("a/b.pdf"))).toBe("a/b.pdf");
    expect(isPanelTab("pdf:docs/paper.pdf")).toBe(true);
    expect(isPanelTab("pdf:")).toBe(false);
    expect(describePanelTab("pdf:docs/paper.pdf").label).toBe("paper.pdf");
  });
});

describe("files are the Editor's, not the strip's", () => {
  test("every file-shaped id names a path, and a bare prefix names nothing", () => {
    // These ids are still the vocabulary every "open this file" gesture speaks
    // — a chip, the display tool, a compiled PDF — and the cockpit reads the
    // path back out of them instead of minting a tab.
    expect(filePanelTabPath("file:src/a.ts")).toBe("src/a.ts");
    expect(filePanelTabPath("view:nb.ipynb")).toBe("nb.ipynb");
    expect(filePanelTabPath("notebook:nb.ipynb")).toBeUndefined();
    expect(filePanelTabPath("pdf:docs/paper.pdf")).toBe("docs/paper.pdf");
    // First separator only: a colon is legal in a filename.
    expect(filePanelTabPath("file:src/weird:name.ts")).toBe("src/weird:name.ts");
    expect(filePanelTabPath("file:")).toBeUndefined();
    expect(filePanelTabPath("files")).toBeUndefined();
    expect(filePanelTabPath("diff")).toBeUndefined();
    expect(isFilePanelTab("browser:p1")).toBe(false);
  });

  test("a file-shaped id never restores into the strip", () => {
    const stored = ["diff", "file:a.ts", "notebook:b.ipynb", "issues", "pdf:c.pdf", "table:d.csv", "editor"];
    expect(stored.filter(isRestorablePanelTab)).toEqual(["diff", "issues", "editor"]);
  });
});

describe("issue and pull-request tabs", () => {
  test("a tab id round-trips to the number the surface will ask gh for", () => {
    expect(issuePanelNumber(issuePanelTab(82))).toBe(82);
    expect(pullPanelNumber(pullPanelTab(12))).toBe(12);
    // And the two do not answer for each other: `issue:82` and `pull:82` are
    // different things with the same number, which is the common case.
    expect(pullPanelNumber(issuePanelTab(82))).toBeUndefined();
    expect(issuePanelNumber(pullPanelTab(12))).toBeUndefined();
    expect(issuePanelNumber("editor")).toBeUndefined();
  });

  test("only DIGITS are a number", () => {
    // Restoring `issue:12abc` from localStorage would open a surface that can only
    // ask gh a question with no answer.
    expect(isPanelTab("issue:82")).toBe(true);
    expect(isPanelTab("pull:1")).toBe(true);
    expect(isPanelTab("issue:")).toBe(false);
    expect(isPanelTab("issue:12abc")).toBe(false);
    expect(isPanelTab("issue:-4")).toBe(false);
    expect(isPanelTab("issue:0")).toBe(false);
    expect(isPanelTab("pull:1.5")).toBe(false);
  });

  test("a detail id is a request and never restores as a tab of its own", () => {
    expect(isRestorablePanelTab(issuePanelTab(675))).toBe(false);
    expect(isRestorablePanelTab(pullPanelTab(666))).toBe(false);
    expect(isRestorablePanelTab("issues")).toBe(true);
  });
});

describe("retired surfaces", () => {
  test("a stored Usage, Agents or Processes tab id restores as nothing", () => {
    // Refusing the id is what makes a restore drop the tab instead of rendering a blank pane.
    for (const retired of ["usage", "agents", "processes"]) expect(isPanelTab(retired)).toBe(false);
    expect(isPanelTab("terminal")).toBe(true);
  });
});

describe("a browser tab's label comes from the live page when the shell has one", () => {
  const journal = { provider: "engine" as never, tabs: [{ id: "p1", title: "Old title", url: "https://old.example", active: true }] } as never;

  test("the journal alone names the page, and a missing page says so", () => {
    expect(describePanelTab(browserPanelTab("p1"), journal).label).toBe("Old title");
    expect(describePanelTab(browserPanelTab("gone"), journal)).toMatchObject({ label: "Closed page", missing: true });
  });

  test("a live tab with the same id wins over the journal", () => {
    const live = [{ id: "p1", title: "Example Domain", url: "https://example.com", active: true }];
    expect(describePanelTab(browserPanelTab("p1"), journal, live)).toMatchObject({ label: "Example Domain", blurb: "https://example.com" });
  });

  test("a page the shell does not list is never named after another live page", () => {
    const live = [{ id: "native-b", title: "Example Domain", url: "https://example.com", active: true }];
    expect(describePanelTab(browserPanelTab("gone"), journal, live)).toMatchObject({ label: "Closed page", missing: true });
  });

  test("no live tabs at all falls back to the journal's answer", () => {
    expect(describePanelTab(browserPanelTab("gone"), journal, [])).toMatchObject({ label: "Closed page", missing: true });
  });

  test("a cockpit with no shell takes the favicon from the engine's page state", () => {
    const remote = { provider: "attached", tabs: [{ id: "p1", title: "One", url: "https://one.example", active: true, favicon: "https://one.example/f.ico" }] } as never;
    expect(describePanelTab(browserPanelTab("p1"), remote).favicon).toBe("https://one.example/f.ico");
    expect(describePanelTab(browserPanelTab("p1"), journal).favicon).toBeUndefined();
  });
});

describe("a surface's letter", () => {
  test("its ⌘⇧ chord opens the same surface from anywhere, plugins included", () => {
    const panels = [{ plugin: "latex", pluginName: "LaTeX", panel: { id: "compile", label: "Compile", verb: "panel" } }];
    const rows = launcherRows([], { pluginPanels: panels, canOpenNew: true, shells: true, browser: {} });
    const commands = new Map<string, string>([["browser", BROWSER_SURFACE.command], ...surfaceCommands({ shells: true, pluginPanels: panels }).map(({ command, tab }) => [tab, command] as [string, string])]);
    const keyed = rows.filter((row) => row.key);
    expect(keyed.map((row) => row.key)).toEqual(["b", "t", "e", "d", "s", "i", "u", "x"]);
    for (const row of keyed) {
      const chord = { key: row.key!.toUpperCase(), code: `Key${row.key!.toUpperCase()}`, metaKey: true, shiftKey: true };
      expect(resolveCommandForEvent(defaultKeymap(), chord)).toBe(commands.get(row.id)!);
    }
  });

  test("Plugins is offered only while an enabled plugin draws something there", () => {
    const panels = [{ plugin: "latex", pluginName: "LaTeX", panel: { id: "compile", label: "Compile", verb: "panel" } }];
    expect(launcherRows([], { pluginPanels: [], canOpenNew: true, shells: true }).map((row) => row.id)).not.toContain("plugin-panels");
    expect(launcherRows([], { pluginPanels: panels, canOpenNew: true, shells: true }).map((row) => row.id)).toContain("plugin-panels");
    expect(surfaceCommands({ shells: true }).map((entry) => entry.command)).not.toContain("open-plugin-panels");
    expect(isPanelTab("plugin-panels")).toBe(true);
  });

  test("an open singleton leaves the launcher; a second Terminal or Diff stays as another", () => {
    const open = [{ id: "issues", kind: "issues", params: {} }, { id: "terminal", kind: "terminal", params: {} }, { id: "diff", kind: "diff", params: {} }] as const;
    const rows = launcherRows([...open], { pluginPanels: [], canOpenNew: true, shells: true });
    expect(rows.some((row) => row.id === "issues")).toBe(false);
    expect(rows.find((row) => row.id === "terminal")?.another).toBe(true);
    expect(rows.find((row) => row.id === "diff")?.another).toBe(true);
    expect(rows.some((row) => row.id === "browser")).toBe(false);
  });

  test("offers no Agents or Processes surface", () => {
    const labels = launcherRows([], { pluginPanels: [], canOpenNew: true, shells: true }).map((row) => row.label);
    expect(labels).not.toContain("Agents");
    expect(labels).not.toContain("Processes");
  });

  test("a client that cannot open a shell is offered no Terminal, by letter or by chord", () => {
    const rows = launcherRows([], { pluginPanels: [], canOpenNew: true, shells: false });
    expect(rows.map((row) => row.id)).not.toContain("terminal");
    expect(launcherRowForKey(rows, "t")).toBeUndefined();
    expect(surfaceCommands({ shells: false }).map((entry) => entry.command)).not.toContain("open-terminal");
    expect(surfaceCommands({ shells: true }).map((entry) => entry.command)).toContain("open-terminal");
  });
});
