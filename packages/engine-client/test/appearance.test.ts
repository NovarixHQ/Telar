import { expect, test } from "bun:test";
import {
  composeGradient,
  DEFAULT_GRADIENT_SPECS,
  MAX_GRADIENT_STOPS,
  parseGradientCss,
  parseGradientSpec,
  parsePublishedAppearance,
  type CustomGradientSpec,
  type PublishedAppearance,
  type ScenePresets,
} from "../src/appearance/schema";

/** The smallest published appearance, so each test can say what it is about. */
function published(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 3, composition: {}, ...patch };
}


function spec(patch: Partial<CustomGradientSpec> = {}): CustomGradientSpec {
  return { type: "linear", angle: 160, centerX: 50, centerY: 50, stops: [], ...patch };
}

const DUSK_LIGHT = spec({ angle: 180, stops: [{ color: "#ffdad0", position: 0, opacity: 100 }, { color: "#ffe4e3", position: 100, opacity: 100 }] });
const DUSK_DARK = spec({ angle: 180, stops: [{ color: "#663028", position: 0, opacity: 100 }, { color: "#100606", position: 100, opacity: 100 }] });
const PRESETS: ScenePresets = {
  expand: (id, mode) => (id === "dusk" ? (mode === "light" ? DUSK_LIGHT : DUSK_DARK) : undefined),
  fallback: "dusk",
};

test("a preset gradient layer expands per state, and round-trips", () => {
  const stored = published({
    composition: {
      light: { base: "#f0f0f0", layers: [{ type: "gradient", presetId: "dusk", opacity: 60 }], overrides: {} },
      dark: { base: "#101010", layers: [{ type: "gradient", presetId: "dusk", opacity: 60 }], overrides: {} },
    },
  });
  const opened = parsePublishedAppearance(stored, PRESETS)!;
  expect(opened.composition.light.layers).toEqual([{ type: "gradient", spec: DUSK_LIGHT, opacity: 60 }]);
  expect(opened.composition.dark.layers).toEqual([{ type: "gradient", spec: DUSK_DARK, opacity: 60 }]);

  const reopened = parsePublishedAppearance(JSON.parse(JSON.stringify(opened)))!; // no starter table at all this time
  expect(reopened.composition).toEqual(opened.composition);
});

test("a spec composes to CSS and the CSS reads back into the same spec", () => {
  const cases: CustomGradientSpec[] = [
    spec({ stops: [{ color: "#ff0000", position: 0, opacity: 100 }, { color: "#0000ff", position: 100, opacity: 100 }] }),
    // Five stops, uneven positions, and a stop faded to nothing — which is how
    // a gradient ends in what is under it.
    spec({
      angle: 42,
      stops: [
        { color: "#112233", position: 0, opacity: 100 },
        { color: "#445566", position: 12, opacity: 80 },
        { color: "#778899", position: 50, opacity: 40 },
        { color: "#aabbcc", position: 73, opacity: 20 },
        { color: "#ddeeff", position: 100, opacity: 0 },
      ],
    }),
    spec({ type: "radial", centerX: 20, centerY: 80, stops: [{ color: "#abcdef", position: 0, opacity: 100 }, { color: "#fedcba", position: 100, opacity: 50 }] }),
  ];
  for (const value of cases) {
    const css = composeGradient(value);
    const back = parseGradientCss(css);
    expect(back).toEqual(value.type === "radial" ? { ...value, angle: DEFAULT_GRADIENT_SPECS.light.angle } : value);
    expect(composeGradient(back!)).toBe(css);
  }
  expect(cases[1].stops.length).toBe(MAX_GRADIENT_STOPS);

  // An authored mesh, or anything hand-edited, is refused rather than
  // half-understood — the caller opens on a default instead.
  expect(parseGradientCss("radial-gradient(at 14% 18%, oklch(0.93 0.07 165) 0px, transparent 55%)")).toBeNull();
  expect(parseGradientCss("linear-gradient(10deg, #fff, #000)")).toBeNull(); // no positions
  expect(parseGradientCss(42)).toBeNull();
});

test("a stored spec is total, and a stop list too short is no spec at all", () => {
  expect(parseGradientSpec({ stops: [{ color: "#fff", position: 0, opacity: 100 }] })).toBeUndefined();
  expect(parseGradientSpec(null)).toBeUndefined();
  // Out of range clamps; an unsafe colour is dropped, which can take the list
  // below two and so take the whole spec with it.
  expect(parseGradientSpec({ type: "radial", angle: 400, centerX: -9, centerY: 900, stops: [{ color: "#fff", position: 900, opacity: -5 }, { color: "#000" }] })).toEqual({
    type: "radial",
    angle: 40,
    centerX: 0,
    centerY: 100,
    stops: [{ color: "#fff", position: 100, opacity: 0 }, { color: "#000", position: 0, opacity: 100 }],
  });
  expect(parseGradientSpec({ stops: [{ color: "red; } html {", position: 0, opacity: 100 }, { color: "#000", position: 100, opacity: 100 }] })).toBeUndefined();
});

test("a composition is read as itself, and a hostile override never lands", () => {
  const composed = parsePublishedAppearance(
    published({
      composition: {
      light: { base: "#101010", layers: [{ type: "gradient", spec: DUSK_LIGHT, opacity: 40 }], overrides: { card: "#ffffff" } },
        dark: { base: "#202020", layers: [], overrides: {} },
      },
      images: { a: "data:image/webp;base64,AAAA", b: "https://example.com/cat.png" },
    }),
  )!;

  expect(composed.composition.light).toEqual({
    base: "#101010",
    layers: [{ type: "gradient", spec: DUSK_LIGHT, opacity: 40 }],
    overrides: { card: "#ffffff" },
  });
  // Overrides end up in a compiled stylesheet, so they pass the same gate every
  // other colour in this file does; a remote URL is not image data.
  expect(parsePublishedAppearance(published({ composition: { light: { base: "#fff", overrides: { card: "red; } html {" } } } }))!.composition.light.overrides).toEqual({});
  expect(composed.images).toEqual({ a: "data:image/webp;base64,AAAA" });

  // A pre-composer layer whose value is not a gradient at all is dropped rather
  // than left as a gap in a positional list.
  expect(parsePublishedAppearance(published({ composition: { light: { layers: [{ type: "custom-gradient", css: "not a gradient" }] } } }))!.composition.light.layers).toEqual([]);
});

test("a published appearance is total, gated, and fatal only without a composition", () => {
  const blob: PublishedAppearance = {
    ...parsePublishedAppearance(published())!,
    version: 3,
    updatedAtHint: 42,
    scheme: "light",
    translucent: true,
    frost: "clear",
    resolved: {
      accent: { name: "sea", light: { primary: "oklch(0.5 0 0)", primaryForeground: "oklch(1 0 0)" }, dark: { primary: "oklch(0.7 0 0)", primaryForeground: "oklch(0.2 0 0)" } },
      fontStacks: { sans: '"Geist", sans-serif', mono: '"Geist Mono", monospace' },
    },
  };
  expect(parsePublishedAppearance(blob)).toEqual(blob);

  expect(parsePublishedAppearance({ ...blob, composition: "none" })).toBeUndefined();
  expect(parsePublishedAppearance("telar")).toBeUndefined();

  // The window facts default rather than refuse.
  expect(parsePublishedAppearance(published({ accent: "chartreuse", fontSize: 900 }))).toMatchObject({
    scheme: "system",
    translucent: false,
    frost: "blur",
    updatedAtHint: 0,
    accent: "indigo",
    fontSize: 18,
    depth: "soft",
  });

  const halfResolved = parsePublishedAppearance({ ...blob, resolved: { ...blob.resolved, accent: { name: "sea", light: blob.resolved!.accent.light } } });
  expect(halfResolved?.resolved).toBeUndefined();

  const hostile = parsePublishedAppearance({
    ...blob,
    resolved: { ...blob.resolved, fontStacks: { sans: "Geist; } html { display: none", mono: "monospace" } },
  });
  expect(hostile?.resolved).toBeUndefined();
});

test("published font faces are kept only as data: @font-face rules that cannot leave a style element", () => {
  const resolved = {
    accent: { name: "sea", light: { primary: "#000000", primaryForeground: "#ffffff" }, dark: { primary: "#ffffff", primaryForeground: "#000000" } },
    fontStacks: { sans: '"Geist", sans-serif', mono: "monospace" },
  };
  const faces = (fontFaces: string) => parsePublishedAppearance(published({ resolved: { ...resolved, fontFaces } }))?.resolved?.fontFaces;
  const face = '@font-face{font-family:"Geist";src:url(data:font/woff2;base64,d09GMg==);font-style:normal}';
  expect(faces(face + face)).toBe(face + face);
  expect(faces(`${face}</style><script>alert(1)</script>`)).toBeUndefined();
  expect(faces("html{display:none}")).toBeUndefined();
  expect(faces(`@font-face{src:url(data:x)}}html{display:none}`)).toBeUndefined();
});
