/**
 * The settings panes are a lookup: Data Science resolves to the editors it always had, and a plugin with no entry
 * falls back to the generic pane rather than to nothing.
 */
import { expect, mock, test } from "bun:test";

/** The bespoke panes read the router on render. Stubbed as in `data-science-section.test.tsx`. */
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { machineBlocksFor, projectPaneFor, SETTINGS_PANES } = await import("./settings-panes");
const { DataScienceSection } = await import("../data-science/data-science-section");
const { DataSciencePackagesRow } = await import("../data-science/machine-settings");

test("only Data Science still ships its own panes; LaTeX draws through its declared views", () => {
  expect(projectPaneFor("data-science")).toBe(DataScienceSection);
  // The Mac scope is generated; each adds the one block its schema cannot express.
  expect(machineBlocksFor("data-science").machineRows).toBe(DataSciencePackagesRow);
  expect(projectPaneFor("latex")).toBeUndefined();
  expect(Object.keys(SETTINGS_PANES)).toEqual(["data-science"]);
});

test("a plugin with no entry resolves to none — including an inherited key", () => {
  expect(projectPaneFor("hello")).toBeUndefined();
  expect(machineBlocksFor("hello").machineRows).toBeUndefined();
  expect(projectPaneFor("constructor")).toBeUndefined();
});
