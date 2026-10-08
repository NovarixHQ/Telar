import { expect, test } from "bun:test";
import { clampPanelWidth, panelWidthOf, standsAside } from "./panel-width";

test("the column stays between 320 and 720pt and leaves the chat 560pt", () => {
  expect(clampPanelWidth(440, 1376)).toBe(440);
  expect(clampPanelWidth(100, 1376)).toBe(320);
  expect(clampPanelWidth(900, 1376)).toBe(720);
  expect(clampPanelWidth(600, 1032)).toBe(472);
  expect(clampPanelWidth(600, 700)).toBe(320);
});

test("a stored width that isn't a number reads as the ideal 440pt", () => {
  expect(panelWidthOf(512)).toBe(512);
  expect(panelWidthOf("wide")).toBe(440);
  expect(panelWidthOf(undefined)).toBe(440);
});

test("the sidebar stands aside when the panel fills the window or three columns don't fit", () => {
  expect(standsAside(true, false, 1376, 380)).toBe(false);
  expect(standsAside(true, false, 1376, 440)).toBe(true);
  expect(standsAside(true, false, 1032, 440)).toBe(true);
  expect(standsAside(true, true, 1376, 320)).toBe(true);
  expect(standsAside(false, true, 1032, 440)).toBe(false);
});
