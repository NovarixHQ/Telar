import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IDENTITY_COLORS, TELAR_ICONS } from "@telar/engine-client";
import type { BrowserProfile } from "../desktop-browser-profiles";
import { flush, mount, press, installTestDom } from "@/test/dom";
import { IdentityIcon, identityColorVar, telarIconGlyph, NO_ICON_GLYPH } from "@/ui/telar-icons";
import { DesktopBrowserSurface } from "../components/desktop-browser-surface";
import { type DesktopBrowserBridge, type DesktopBrowserPanelState } from "../types";
import { ProfileColorPicker, ProfileIconPicker } from "./browser-profile-marks";
import { BrowserProfilesRows } from "./browser-profiles-section";

installTestDom();

afterEach(() => {
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});

const radios = () => [...document.querySelectorAll('[role="radio"]')];
const radio = (label: string) => radios().find((option) => option.getAttribute("aria-label") === label)!;

describe("the icon picker", () => {
  test("opens a grid of the app's own icons and hands back the id that was clicked", async () => {
    const picked: (string | null)[] = [];
    const { host } = await mount(<ProfileIconPicker profile="Work" onPick={(icon) => picked.push(icon)} />);
    await press(host.querySelector("button")!);
    expect(radios()).toHaveLength(TELAR_ICONS.length + 1);
    await press(radio("briefcase"));
    expect(picked).toEqual(["briefcase"]);
  });

  test("offers 'none' first-class, so a mark can be taken off", async () => {
    const picked: (string | null)[] = [];
    const { host } = await mount(<ProfileIconPicker profile="Work" icon="globe" onPick={(icon) => picked.push(icon)} />);
    await press(host.querySelector("button")!);
    await press(radio("No icon"));
    // null means "clear this"; an absent key means "leave it alone".
    expect(picked).toEqual([null]);
  });

  test("the current icon is checked, and the trigger says which profile it belongs to", async () => {
    const { host } = await mount(<ProfileIconPicker profile="Client review" icon="rocket" onPick={() => {}} />);
    const trigger = host.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("Icon for Client review");
    await press(trigger);
    const checked = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')];
    expect(checked.map((option) => option.getAttribute("aria-label"))).toEqual(["rocket"]);
  });
});

describe("the colour picker", () => {
  test("offers the eight identity hues and 'none', and hands back the token", async () => {
    const picked: (string | null)[] = [];
    const { host } = await mount(<ProfileColorPicker profile="Work" onPick={(color) => picked.push(color)} />);
    const trigger = host.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("Colour for Work");
    await press(trigger);
    expect(radios().map((option) => option.getAttribute("aria-label"))).toEqual([...IDENTITY_COLORS, "No colour"]);
    await press(radio("amber"));
    expect(picked).toEqual(["amber"]);
  });

  test("a hue is painted from its variable, so it follows the theme", async () => {
    const { host } = await mount(<ProfileColorPicker profile="Work" color="sea" onPick={() => {}} />);
    await press(host.querySelector("button")!);
    const sea = radio("sea") as HTMLElement;
    expect(sea.style.backgroundColor).toContain("--subject-sea");
    expect(sea.getAttribute("aria-checked")).toBe("true");
  });
});

describe("a mark, drawn", () => {
  test("a chosen icon is drawn in its colour", () => {
    const html = renderToStaticMarkup(<IdentityIcon icon="briefcase" color="amber" className="size-4" />);
    expect(html).toContain("lucide-briefcase");
    expect(html).toContain("var(--subject-amber)");
  });

  test("an unmarked profile gets the neutral ring and the surface's own colour, never a crash", () => {
    const html = renderToStaticMarkup(<IdentityIcon />);
    expect(html).toContain("lucide-circle");
    expect(html).toContain("currentColor");
    expect(telarIconGlyph("a-glyph-from-the-future")).toBe(NO_ICON_GLYPH);
    expect(telarIconGlyph(undefined)).toBe(NO_ICON_GLYPH);
    expect(identityColorVar("chartreuse")).toBe("currentColor");
  });

  test("every id in the shared set has a glyph of its own", () => {
    const glyphs = TELAR_ICONS.map((icon) => telarIconGlyph(icon));
    expect(glyphs.filter((glyph) => glyph === NO_ICON_GLYPH)).toHaveLength(0);
    expect(new Set(glyphs).size).toBe(TELAR_ICONS.length);
  });
});

describe("the browser panel's profile marks", () => {
  const work = { id: "bp_1", label: "Work", partition: "persist:a", icon: "briefcase", color: "amber", account: "me@work.example" };
  const home = { id: "bp_2", label: "Home", partition: "persist:b", icon: "rocket" };
  const state = {
    scopeKey: "session_a",
    tabs: [
      {
        index: 0, id: "tab_1", title: "Example", url: "https://example.com/", active: true, loading: false, canGoBack: false, canGoForward: false,
        zoom: 1, colorScheme: "system", preview: false, viewport: { width: 1280, height: 800, preset: "default", mode: "fit" },
      },
    ],
    profile: work,
    profiles: [work, home],
    presentation: { width: 1280, height: 800, scale: 0.5, rect: { x: 0, y: 0, width: 640, height: 400 } },
  } as unknown as DesktopBrowserPanelState;
  const bridge: DesktopBrowserBridge = {
    getState: async () => state,
    action: async () => state,
    setBounds: async () => {},
    setVisible: async () => {},
    onState: () => () => {},
    setScopeProfile: async () => ({ profileId: "bp_1", partition: "persist:a" }),
  };

  async function profileRow() {
    const { host } = await mount(<DesktopBrowserSurface bridge={bridge} scopeKey="session_a" projectId="project_a" />);
    await flush(() => Boolean(host.querySelector('[aria-label="Browser options"]')));
    await press(host.querySelector('[aria-label="Browser options"]')!);
    return [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Profile:")) as HTMLElement;
  }

  test("the ⋯ menu's profile row shows the profile's icon in its colour beside its name", async () => {
    const row = await profileRow();
    expect(row.textContent).toBe("Profile: Work");
    expect(row.innerHTML).toContain("lucide-briefcase");
    expect(row.innerHTML).toContain("var(--subject-amber)");
  });

  test("its pane lists every profile by name, with its glyph beside it", async () => {
    await press(await profileRow());
    const rows = [...document.querySelectorAll("button[aria-pressed]")];
    expect(rows.map((row) => row.textContent)).toEqual(["Work", "Home"]);
    expect(rows[1]!.innerHTML).toContain("lucide-rocket");
  });
});

describe("the settings row", () => {
  const PROFILES: BrowserProfile[] = [{ id: "bp_work", label: "Work", partition: "persist:a", createdAt: 1, icon: "briefcase", color: "sea" }];

  async function mountSection() {
    const updates: Record<string, unknown>[] = [];
    (window as { telarDesktop?: unknown }).telarDesktop = {
      browser: {
        profiles: async () => ({ profiles: PROFILES }),
        updateProfile: async (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { profiles: PROFILES };
        },
      },
    };
    const { host } = await mount(<BrowserProfilesRows />);
    await flush(() => Boolean(host.querySelector('[aria-label="Icon for Work"]')));
    return { host, updates };
  }

  test("its marks show the profile's own glyph and colour rather than a generic person icon", async () => {
    const { host } = await mountSection();
    expect(host.querySelector('[aria-label="Icon for Work"] svg.lucide-briefcase')).toBeTruthy();
    expect(host.querySelector('[aria-label="Colour for Work"]')?.innerHTML).toContain("var(--subject-sea)");
  });

  test("each mark is written on its own, so setting one cannot clear the other", async () => {
    const { host, updates } = await mountSection();
    await press(host.querySelector('[aria-label="Icon for Work"]')!);
    await press(radio("rocket"));
    await press(host.querySelector('[aria-label="Colour for Work"]')!);
    await press(radio("amber"));
    expect(updates).toEqual([
      { profileId: "bp_work", icon: "rocket" },
      { profileId: "bp_work", color: "amber" },
    ]);
  });
});
