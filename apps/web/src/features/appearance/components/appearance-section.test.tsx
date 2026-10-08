/**
 * THE APPEARANCE PANE IS STACKED GROUPS, NOT TABS — issue #399.
 *
 * WHAT IS ACTUALLY BEING GUARDED. The complaint was not that any one control
 * was wrong; it was that three quarters of the pane was behind a `Tabs` strip,
 * so "what can I change here?" could only be answered by clicking four times,
 * and settings search pointed at rows that did not exist until you did. Both
 * facts are structural, and both are invisible to a test of any single control
 * — so what is pinned here is the SHAPE: every group on the page at once, no
 * tablist anywhere, and the Window rows carrying the anchors the search index
 * computes for them without ever rendering the pane.
 *
 * MOUNTED, NOT SERVER-RENDERED. The backdrop group reads payloads that live in
 * localStorage, so it holds back to "nothing under the app" for the one render
 * that happens before the stores can be read. `renderToStaticMarkup` would
 * therefore assert against a pane in its pre-hydration state, which is not the
 * pane this file is about.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SlidersHorizontalIcon } from "lucide-react";
import { Row, SettingsGroup, SettingsShell } from "@/features/settings/components/settings-shell";
import { SETTINGS_SEARCH_INDEX } from "@/features/settings";
import { TELAR_DARK, TELAR_LIGHT } from "@telar/engine-client";
import { STATE_INK, TINT_FLOOR, tintCost } from "../tint-separation";
import { readTheme } from "./theme-provider";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AppearanceSection } = await import("./appearance-section");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<AppearanceSection />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

afterAll(() => {
  act(() => root.unmount());
  window.localStorage.clear();
  GlobalRegistrator.unregister();
});

/** The group captions `SettingsGroup` draws, in the order they are stacked. */
function captions(): string[] {
  return [...host.querySelectorAll("h4")].map((heading) => heading.textContent ?? "");
}

describe("the pane is a stack of settings groups", () => {
  test("every group is on the page at once, in reading order", () => {
    expect(captions()).toEqual(["Theme", "Window"]);
  });

  test("the colour scheme leads the Theme group, and Restore Telar's default closes the pane", () => {
    const scheme = host.querySelector('[aria-label="Colour scheme"]');
    const firstGroup = host.querySelector("section")!;
    expect(scheme?.closest("section")).toBe(firstGroup);
    expect(firstGroup.querySelector('[id^="settings-row-"]')?.id).toBe("settings-row-theme-colour-scheme");
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.at(-1)?.textContent).toBe("Restore Telar's default");
  });

  test("there is no tab strip left anywhere on it", () => {
    // The regression this file exists for: a group put back behind a word.
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tab"]')).toBeNull();
  });

  test("there is one appearance: no theme or look to pick", () => {
    expect(host.textContent).not.toMatch(/\blooks?\b/i);
    expect(host.textContent).not.toContain("theme pair");
    expect(host.textContent).not.toContain("Light theme");
    expect(host.textContent).not.toContain("Backdrop");
  });
});

describe("the rows settings search points at", () => {
  test("the Window rows carry the anchor the index computes for them", () => {
    // The two halves of the contract in lib/settings-search.ts: the index
    // derives an id without rendering, and `Row` stamps the same one as it
    // renders. They agree only while the group heading and the pane id do.
    const indexed = SETTINGS_SEARCH_INDEX.entries.filter((entry: { pageId: string }) => entry.pageId === "appearance");
    const ids = indexed.map((entry: { id: string }) => entry.id);
    expect(ids).toContain("settings-row-appearance-window-translucency");
    expect(ids).toContain("settings-row-appearance-window-layers-through-canvas-and-rail");
    expect(ids).toContain("settings-row-appearance-theme-accent");
    expect(ids).toContain("settings-row-appearance-theme-base");
  });

  test("the rows on the page derive the GROUP half of those ids", () => {
    /**
     * THE PANE HALF IS THE SHELL'S AND IS ABSENT HERE, on purpose. `Row` reads
     * its pane from `SettingsShell`'s context (settings-shell.tsx), and this
     * mounts the section on its own — so the ids it stamps are group-and-label,
     * `settings-row-window-layers-through-canvas-and-rail`. That is exactly the half #399 moved:
     * before, these rows had no group at all and derived
     * `settings-row-show-through`. The pane half is pinned by
     * settings-registry.test.ts, against the same `settingsRowId`.
     *
     * Translucency and Glass need the macOS shell to exist at all, so they are
     * not assertable in a browser tab; the rest are.
     */
    expect(host.querySelector("#settings-row-window-layers-through-canvas-and-rail")).not.toBeNull();
    expect(host.querySelector("#settings-row-theme-accent")).not.toBeNull();
    expect(host.querySelector("#settings-row-theme-base")).not.toBeNull();
  });

  test("no row claims an anchor twice", () => {
    // Show-through used to be rendered in two groups, which made
    // `getElementById` answer whichever came first. There is one now.
    const claimed = [...host.querySelectorAll('[id^="settings-row-"]')].map((row) => row.id);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});

/**
 * THE COMPOSER IS THE THEME — issue #471.
 *
 * "Gradient and theme are different things here. We inject the gradients over
 * the theme, where I always thought that a gradient would be part of a theme.
 * Themes should not exist." So the Colour group's two theme pickers and the
 * Backdrop group's four-way mode picker are one group with one model: a base
 * colour, a stack of layers over it, and the sixteen tokens folded away as
 * OVERRIDES of what the base derived.
 */
describe("the Theme group", () => {
  function composerGroup(): HTMLElement | null {
    return [...host.querySelectorAll("section")].find((section) => section.querySelector("h4")?.textContent === "Theme") ?? null;
  }

  test("it carries no light/dark switch of its own: Colour scheme is the one", () => {
    const segments = [...(composerGroup()?.querySelectorAll("button[aria-pressed]") ?? [])].map((button) => button.textContent);
    expect(segments).not.toContain("Light");
    expect(segments).not.toContain("Dark");
    expect(host.querySelectorAll('[aria-label="Colour scheme"]')).toHaveLength(1);
  });

  test("the base leads, and the layers follow it", () => {
    const group = composerGroup();
    expect(group?.querySelector("#settings-row-theme-base")).not.toBeNull();
    const html = group?.innerHTML ?? "";
    expect(html.indexOf("Base")).toBeGreaterThan(-1);
    expect(html.indexOf("Base")).toBeLessThan(html.indexOf("Layers"));
  });

  test("there is no mode picker: a gradient and an image are layer types", () => {
    // The four-way None/Gradient/Image/Compose control is what the model
    // deleted — three of its four kinds were the fourth with a hole in it.
    const segments = [...(composerGroup()?.querySelectorAll("button[aria-pressed]") ?? [])].map((button) => button.textContent);
    expect(segments).not.toContain("Compose");
    expect(segments).not.toContain("None");
  });

  test("an empty stack says so rather than writing a backdrop", () => {
    // A fresh store has no layers, and arriving must not invent any.
    expect(composerGroup()?.textContent).toContain("Nothing over the base");
  });

  test("the sixteen tokens sit behind a closed disclosure", () => {
    const details = composerGroup()?.querySelector("details");
    expect(details).not.toBeNull();
    // Closed on arrival: they are the escape hatch you reach for after the base
    // has answered, not the thing that greets you.
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("Adjust colours");
  });

  /**
   * THE CARD ROW CARRIES A NUMBER NOW, AND IT IS THE TINTS' (#705).
   *
   * Every other row here is a foreground judged against its surface; the card
   * is a surface, so the pairing table had nothing for it and the row showed
   * nothing — while being the one token that decides whether `.tint-success`
   * and friends can be read. The figure is the REPAIRED one, because
   * `compileComposition` moves the state ink when this card requires it and a
   * row must show what the window will paint, not what it would have painted.
   *
   * The expected value is computed through the same module the row uses, so
   * this cannot drift from globals.css; what it pins is that the row asks the
   * tint question at all, and that a surface with no question still shows
   * nothing.
   */
  test("the card row reports what the card costs the semantic tints", () => {
    const rows = composerGroup()?.querySelector("details");
    const card = rows?.querySelector('label[title="--card"]');
    expect(card).not.toBeNull();
    const shown = [...(card?.querySelectorAll("span") ?? [])].find((span) => /^\d+\.\d$/.test(span.textContent ?? ""));
    expect(shown, "the card row shows a ratio").not.toBeUndefined();

    // WHICH HALF IS ON SCREEN is the window's colour scheme, so the stored
    // scheme is asked rather than assumed — the state ink differs between the
    // two and a test that guessed would pass for the wrong reason.
    const dark = readTheme() === "dark";
    const expected = tintCost(dark ? TELAR_DARK.card : TELAR_LIGHT.card, dark ? STATE_INK.dark : STATE_INK.light, TINT_FLOOR);
    expect(shown?.textContent).toBe(expected.readability.toFixed(1));
    expect(shown?.getAttribute("title")).toContain(`.tint-${expected.tone}`);
    // Telar's own card clears the bar, so the figure is quiet rather than red.
    expect(expected.readability).toBeGreaterThanOrEqual(4.5);
    expect(shown?.className).not.toContain("text-destructive");

    // And a surface with no question still shows no answer: `--popover` is
    // judged by `--popover-foreground`, not the other way round.
    const popover = rows?.querySelector('label[title="--popover"]');
    expect([...(popover?.querySelectorAll("span") ?? [])].some((span) => /^\d+\.\d$/.test(span.textContent ?? ""))).toBe(false);
  });

  test("every token row says where it paints, not just what it is called", () => {
    // Rendered even while the disclosure is closed — `details` hides its
    // content, it does not unmount it — which is what lets this assert the
    // pairing rather than the folding.
    const tokens = composerGroup()?.querySelector("details")?.textContent ?? "";
    expect(tokens).toContain("The canvas the whole window sits on");
    expect(tokens).toContain("Every hairline in the app");
    expect(tokens).toContain("A rail row under the pointer");
  });

  /**
   * GRADIENTS ARE AUTHORED, NOT PICKED — round three of #471. "It needs
   * gradient customization. We give a lot of options; what if instead we let
   * the user create them." There is one way to have a gradient now, and it is
   * to build one; the eleven presets fill the editor and are then forgotten.
   */
  describe("a gradient layer", () => {
    async function addGradient(): Promise<void> {
      const add = [...(composerGroup()?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Gradient")) as
        | HTMLButtonElement
        | undefined;
      await act(async () => {
        add?.click();
      });
    }

    test("there is one way to add one, and it opens its stops", async () => {
      // "Gradient" beside "Custom" asked a reader to decide, before seeing
      // anything, whether they were the sort of person who edits gradients.
      const adders = [...(composerGroup()?.querySelectorAll("button") ?? [])].map((button) => button.textContent);
      expect(adders.filter((text) => text?.includes("Gradient"))).toHaveLength(1);
      expect(adders).not.toContain("Custom");

      await addGradient();
      expect(composerGroup()?.textContent).toContain("This gradient");
      expect(composerGroup()?.textContent).toContain("Linear gradient");
    });

    test("every stop has a colour input, and the strip has a handle each", async () => {
      await addGradient();
      const colours = composerGroup()?.querySelectorAll('input[type="color"][aria-label^="Stop "]') ?? [];
      const handles = [...(composerGroup()?.querySelectorAll("button") ?? [])].filter((button) =>
        (button.getAttribute("aria-label") ?? "").match(/^Stop \d+, at \d+%$/),
      );
      // A fresh gradient opens on the two-stop default: one input and one
      // draggable handle each, which is what "authored" is made of.
      expect(colours).toHaveLength(2);
      expect(handles).toHaveLength(2);
      // …and the selected stop's own position and fade.
      const labels = [...(composerGroup()?.querySelectorAll('input[type="range"]') ?? [])].map((input) => input.getAttribute("aria-label"));
      expect(labels).toContain("Stop 1 position");
      expect(labels).toContain("Stop 1 opacity");
    });

    test("the presets survive as chips that fill the editor, not as a kind", async () => {
      await addGradient();
      const chips = [...(composerGroup()?.querySelectorAll("button") ?? [])].filter((button) =>
        (button.getAttribute("title") ?? "").startsWith("Fill these stops with "),
      );
      expect(chips.map((chip) => chip.textContent)).toContain("Dusk");
      // Eleven starters, and picking one writes five stops into THIS layer
      // rather than making it a Dusk-kind layer.
      expect(chips).toHaveLength(11);
      await act(async () => {
        chips.find((chip) => chip.textContent === "Dusk")?.click();
      });
      expect(composerGroup()?.querySelectorAll('input[type="color"][aria-label^="Stop "]')).toHaveLength(5);
      expect(composerGroup()?.textContent).not.toContain("Dusk gradient");
    });

    test("a radial gradient is centred rather than angled", async () => {
      await addGradient();
      const shape = [...(composerGroup()?.querySelectorAll("button[aria-pressed]") ?? [])].find((button) => button.textContent === "Radial") as
        | HTMLButtonElement
        | undefined;
      const angles = () => [...(composerGroup()?.querySelectorAll('input[type="range"]') ?? [])].map((input) => input.getAttribute("aria-label"));
      expect(angles()).toContain("Gradient angle");
      await act(async () => {
        shape?.click();
      });
      // A slider that moves nothing is a bug report, so only ever one of the
      // two is drawn.
      expect(angles()).not.toContain("Gradient angle");
      expect(angles()).toContain("Gradient centre X");
      expect(angles()).toContain("Gradient centre Y");
    });
  });

  test("a token follows the base until it is set, and says so", () => {
    // The sparse override is the whole model: a value here is one somebody set
    // BY HAND, and a fresh composition has none — so every revert is inert.
    expect(composerGroup()?.textContent).toContain("Every colour here follows the base until you set it");
    const reverts = [...(composerGroup()?.querySelectorAll("button") ?? [])].filter((button) =>
      (button.getAttribute("aria-label") ?? "").startsWith("Revert "),
    );
    expect(reverts.length).toBe(16);
    expect(reverts.every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});

/**
 * ONE READING COLUMN, AND APPEARANCE IS IN IT — issue #435.
 *
 * The shell sets the measure on a single wrapper around whatever pane is
 * showing (settings-shell.tsx), and Appearance used to be handed an opt-out
 * that swapped `max-w-2xl` for `max-w-[1400px]`. The result read as a second
 * application behind the same nav: cross from General and the column doubled.
 *
 * MOUNTED IN THE SHELL, NOT ASSERTED FROM A CLASS NAME. The claim is about an
 * ANCESTOR — which element actually constrains the pane — so both panes are
 * rendered inside a real `SettingsShell` and the constraining node is found by
 * walking up from something only that pane draws. A test that read the class
 * off the shell in isolation would still pass with the flag restored.
 */
describe("the pane sits in the same reading column as every other", () => {
  /** The shell's measure wrapper, found from a node only this pane renders. */
  function measureAround(marker: string): HTMLElement | null {
    const child = host.querySelector(marker);
    return child?.closest("div.mx-auto.w-full") ?? null;
  }

  async function renderShell(active: string, pane: React.ReactNode) {
    await act(async () => {
      root.render(
        <SettingsShell
          title="Settings"
          sections={[
            { id: "general", label: "General", icon: SlidersHorizontalIcon },
            { id: "appearance", label: "Appearance", icon: SlidersHorizontalIcon },
          ]}
          active={active}
          onSelect={() => undefined}
        >
          {pane}
        </SettingsShell>,
      );
    });
  }

  test("Appearance is wrapped in the measure General is wrapped in", async () => {
    await renderShell("appearance", <AppearanceSection />);
    const appearance = measureAround('[id^="settings-row-"]')?.className;

    await renderShell(
      "general",
      <SettingsGroup title="Settling">
        <Row label="Settle quiet sessions" />
      </SettingsGroup>,
    );
    // Any row will do as the handle — what is being compared is the ancestor
    // above it, not which row it is.
    const general = measureAround('[id^="settings-row-"]')?.className;

    expect(appearance).toBeDefined();
    expect(general).toBeDefined();
    // The SAME class, not merely a narrow one: the regression this guards is a
    // per-pane branch coming back, whatever width it picks.
    expect(appearance).toBe(general);
    expect(appearance).toContain("max-w-4xl");
  });
});

/**
 * EVERY CONTROL WRITES WHAT IT NAMES, AT ONCE — issue #471.
 *
 * The pane used to edit a DRAFT: a whole appearance nobody was wearing, painted onto
 * the document to simulate wearing it, gated behind an Apply button in a sticky
 * masthead that also carried Discard, an undo arrow, a "Previewing" chip and a
 * name field. The owner's complaint was that bar, and the answer was to delete
 * the model behind it rather than to restyle it.
 *
 * WHAT IS GUARDED HERE IS THE ABSENCE. No individual control can show that
 * there is no longer a pending state — each of them looks the same either way —
 * so what is pinned is that the bar and its whole vocabulary are gone.
 */
describe("there is no draft, and nothing to apply", () => {
  test("the masthead's vocabulary is gone from the pane", () => {
    for (const word of ["Apply", "Discard", "Previewing", "Undo"]) {
      expect(host.textContent).not.toContain(word);
    }
  });

  test("nothing on the pane is sticky any more", () => {
    // The bar was the one sticky element here; a group is just a card.
    expect(host.querySelector(".sticky")).toBeNull();
  });

});

describe("Restore Telar's default", () => {
  test("puts back the default after a change", async () => {
    const press = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
      await act(async () => button.click());
    };
    await press("Wide");
    expect(JSON.parse(window.localStorage.getItem("telar-appearance") ?? "{}").chatWidth).toBe("wide");
    await press("Restore Telar's default");
    expect(JSON.parse(window.localStorage.getItem("telar-appearance") ?? "{}").chatWidth).toBe("comfortable");
    expect(window.localStorage.getItem("telar-theme")).toBe("system");
  });
});
