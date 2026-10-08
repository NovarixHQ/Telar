import { afterAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });

const { BACKGROUND_INIT_SCRIPT, GRADIENT_PRESETS } = await import("./background");
const { parseAppearance } = await import("./appearance");

const root = () => document.documentElement;

function firstPaint(stored: unknown) {
  window.localStorage.setItem("telar-appearance", JSON.stringify(stored));
  new Function(BACKGROUND_INIT_SCRIPT)();
  return {
    kind: root().getAttribute("data-backdrop"),
    light: root().style.getPropertyValue("--backdrop-light"),
    dark: root().style.getPropertyValue("--backdrop-dark"),
    strength: root().style.getPropertyValue("--backdrop-strength"),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("data-backdrop");
  root().removeAttribute("style");
});

afterAll(() => GlobalRegistrator.unregister());

test("the first paint wears the stored background before any script loads", () => {
  expect(firstPaint({ background: { kind: "gradient", gradient: "dusk", strength: 40 } })).toEqual({
    kind: "gradient",
    light: GRADIENT_PRESETS.dusk.light,
    dark: GRADIENT_PRESETS.dusk.dark,
    strength: "40%",
  });
  expect(firstPaint({ background: { kind: "image", image: "data:image/jpeg;base64,AAAA", strength: 900 } })).toMatchObject({
    kind: "image",
    light: 'url("data:image/jpeg;base64,AAAA")',
    strength: "100%",
  });
});

test("the first paint refuses anything that is not a picture or a known gradient", () => {
  expect(firstPaint({ background: { kind: "image", image: 'data:image/png;base64,AA") ; } html { display: none' } }).kind).toBeNull();
  expect(firstPaint({ background: { kind: "gradient", gradient: "custom", colours: ["red; }", "#000000"] } }).kind).toBeNull();
  expect(firstPaint({ background: { kind: "gradient", gradient: "constructor" } }).kind).toBeNull();
});

test("an appearance stored before backgrounds existed loads with none", () => {
  expect(parseAppearance(JSON.stringify({ accent: "sea" })).background.kind).toBe("none");
  expect(firstPaint({ accent: "sea" }).kind).toBeNull();
});
