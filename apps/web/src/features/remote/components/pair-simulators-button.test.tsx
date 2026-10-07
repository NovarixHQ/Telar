import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PairSimulatorsButton } from "./pair-simulators-button";

const host = globalThis as { window?: unknown };
afterEach(() => {
  delete host.window;
});

test("a release cockpit offers no simulator pairing", () => {
  host.window = { telarDesktop: { isDesktop: true } };
  expect(renderToStaticMarkup(<PairSimulatorsButton />)).toBe("");
});

test("Telar Dev offers to pair the booted simulators", () => {
  host.window = { telarDesktop: { dev: { pairSimulators: async () => ({ paired: [], failed: [], message: "" }) } } };
  expect(renderToStaticMarkup(<PairSimulatorsButton />)).toContain("Pair booted simulators");
});
