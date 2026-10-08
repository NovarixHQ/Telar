import { expect, test } from "bun:test";
import { SECTION_IDS, SECTIONS } from "./settings-sections";
import { resolveSection } from "./use-section-from-url";

const route = (raw: string | null) => resolveSection(raw, SECTION_IDS);

test("the nav is ten panes, in order", () => {
  expect(SECTIONS.map(({ id }) => id)).toEqual([
    "general",
    "appearance",
    "keybindings",
    "providers",
    "integrations",
    "plugins",
    "projects",
    "source-control",
    "storage",
    "connections",
  ]);
});

test("every current pane id routes to itself", () => {
  for (const id of SECTION_IDS) expect(route(id)).toBe(id);
});


test("plugins share one destination, and removed panes are not routed", () => {
  for (const gone of ["notifications", "latex", "data-science", "schedules", "store", "remote", "tools", "about", "updates", "dictation"]) {
    expect(SECTION_IDS).not.toContain(gone);
    expect(route(gone)).toBeNull();
  }
  expect(route(null)).toBeNull();
});
