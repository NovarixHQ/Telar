import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SlidersHorizontalIcon } from "lucide-react";
import { Row, SettingsGroup, SettingsShell } from "@/features/settings/components/settings-shell";
import { SETTINGS_SEARCH_INDEX } from "@/features/settings";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PICTURE = "data:image/jpeg;base64,/9j/AAAA";
mock.module("../background-image", () => ({ compressImageFile: async (file: File) => (file.type.startsWith("image/") ? PICTURE : Promise.reject(new Error("That file is not an image."))) }));

const { AppearanceSection } = await import("./appearance-section");
const { applyAppearance, useAppearance } = await import("../appearance");

function Worn() {
  const { appearance } = useAppearance();
  useEffect(() => applyAppearance(appearance), [appearance]);
  return <AppearanceSection />;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<Worn />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

afterAll(() => {
  window.localStorage.clear();
  GlobalRegistrator.unregister();
});

const stored = () => JSON.parse(window.localStorage.getItem("telar-appearance") ?? "{}") as Record<string, unknown>;

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}

async function press(label: string) {
  await act(async () => button(label).click());
}

describe("the pane", () => {
  test("shows the colour scheme, accent, depth, both fonts and the window rows, and nothing else", () => {
    expect([...host.querySelectorAll("h4")].map((heading) => heading.textContent)).toEqual(["Theme", "Typography", "Window"]);
    const labels = [...host.querySelectorAll('[id^="settings-row-"]')].map((row) => row.querySelector("span.text-sm")?.textContent);
    expect(labels).toEqual(["Colour scheme", "Accent", "Depth", "Background", "Interface font", "Code font", "Chat width"]);
  });

  test("has no layers, base colour or colour overrides", () => {
    for (const gone of ["Layers", "Base", "Match the other state", "Adjust colours"]) {
      expect(host.textContent).not.toContain(gone);
    }
  });

  test("every row the search index lists is on the page", () => {
    const indexed = SETTINGS_SEARCH_INDEX.entries.filter((entry: { pageId: string; title: string }) => entry.pageId === "appearance").map((entry: { title: string }) => entry.title);
    expect(indexed).toEqual(expect.arrayContaining(["Colour scheme", "Accent", "Background", "Strength", "Interface font", "Code font", "Chat width"]));
    for (const title of ["Layers through canvas and rail", "Base", "Match the other state"]) expect(indexed).not.toContain(title);
  });
});

describe("the background", () => {
  const root = document.documentElement;
  const paint = () => ({ kind: root.getAttribute("data-backdrop"), light: root.style.getPropertyValue("--backdrop-light"), dark: root.style.getPropertyValue("--backdrop-dark") });

  test("starts with nothing behind the cockpit and no strength to set", () => {
    expect(button("None").getAttribute("aria-pressed")).toBe("true");
    expect(root.hasAttribute("data-backdrop")).toBe(false);
    expect(host.querySelector('[aria-label="Strength"]')).toBeNull();
  });

  test("a gradient preset paints its own light and dark ramps, and None takes it away", async () => {
    await press("Gradient");
    expect(paint().kind).toBe("gradient");
    const aurora = paint();
    expect(aurora.light).toContain("linear-gradient");
    expect(aurora.light).not.toBe(aurora.dark);
    await press("Dusk");
    expect(paint().light).not.toBe(aurora.light);
    expect(button("Dusk").getAttribute("aria-checked")).toBe("true");
    await press("None");
    expect(root.hasAttribute("data-backdrop")).toBe(false);
    expect(root.style.getPropertyValue("--backdrop-light")).toBe("");
  });

  test("the custom gradient is one pair of colours worn in both schemes", async () => {
    await press("Gradient");
    await press("Custom");
    const first = host.querySelector<HTMLInputElement>('[aria-label="First colour"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(first, "#112233");
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(paint().light).toBe("linear-gradient(160deg, #112233, #ec4899)");
    expect(paint().dark).toBe(paint().light);
  });

  test("an image is chosen from a file or dropped onto the row", async () => {
    await press("Image");
    expect(root.hasAttribute("data-backdrop")).toBe(false);
    const input = host.querySelector<HTMLInputElement>('[aria-label="Image file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.png", { type: "image/png" })], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(paint()).toEqual({ kind: "image", light: `url("${PICTURE}")`, dark: `url("${PICTURE}")` });

    await press("None");
    const row = host.querySelector('[id^="settings-row-"][id$="background"]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    await act(async () => row.dispatchEvent(drop));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That file is not an image.");
    expect(root.hasAttribute("data-backdrop")).toBe(false);
  });

  test("strength sets how strongly the background shows", async () => {
    await press("Gradient");
    expect(root.style.getPropertyValue("--backdrop-strength")).toBe("60%");
    const slider = host.querySelector<HTMLInputElement>('[aria-label="Strength"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "25");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(root.style.getPropertyValue("--backdrop-strength")).toBe("25%");
    expect(stored().background).toMatchObject({ kind: "gradient", strength: 25 });
  });
});

describe("the colour scheme tiles", () => {
  test("pick the scheme the window wears", async () => {
    await press("Light");
    expect(window.localStorage.getItem("telar-theme")).toBe("light");
    expect(button("Light").getAttribute("aria-pressed")).toBe("true");
    expect(button("Dark").getAttribute("aria-pressed")).toBe("false");
    await press("System");
    expect(window.localStorage.getItem("telar-theme")).toBe("system");
  });
});

describe("the accent", () => {
  test("a swatch sets the accent, and the row can go back to the default", async () => {
    await press("Rose");
    expect(stored().accent).toBe("rose");
    expect(button("Rose").getAttribute("aria-checked")).toBe("true");
    await press("Revert to the default");
    expect(stored().accent).toBe("indigo");
  });
});

describe("the fonts", () => {
  test("each font row has a family and a size picker", () => {
    for (const label of ["Interface font", "Interface font size", "Code font", "Code font size"]) {
      expect(host.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  test("a custom family asks for its name", async () => {
    expect(host.querySelector('[aria-label="Custom interface font"]')).toBeNull();
    window.localStorage.setItem("telar-appearance", JSON.stringify({ fontSans: "custom" }));
    await act(async () => window.dispatchEvent(new Event("storage")));
    expect(host.querySelector('[aria-label="Custom interface font"]')).not.toBeNull();
  });
});

test("Restore defaults puts the appearance and the scheme back", async () => {
  await act(async () => {
    root.render(
      <SettingsShell title="Settings" sections={[{ id: "appearance", label: "Appearance", icon: SlidersHorizontalIcon }]} active="appearance" onSelect={() => undefined}>
        <AppearanceSection />
      </SettingsShell>,
    );
  });
  await press("Wide");
  await press("Dark");
  expect(stored().chatWidth).toBe("wide");
  const restore = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Restore defaults"))!;
  await act(async () => restore.click());
  expect(stored().chatWidth).toBe("comfortable");
  expect(window.localStorage.getItem("telar-theme")).toBe("system");
});

test("Appearance sits in the same reading column as every other pane", async () => {
  const measure = () => host.querySelector('[id^="settings-row-"]')?.closest("div.mx-auto.w-full")?.className;
  const shell = (active: string, pane: React.ReactNode) => (
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
    </SettingsShell>
  );
  await act(async () => root.render(shell("appearance", <AppearanceSection />)));
  const appearance = measure();
  await act(async () =>
    root.render(
      shell(
        "general",
        <SettingsGroup title="Settling">
          <Row label="Settle quiet sessions" />
        </SettingsGroup>,
      ),
    ),
  );
  expect(appearance).toBeDefined();
  expect(appearance).toBe(measure());
});
