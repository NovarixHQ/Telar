import { expect, test } from "bun:test";
import { parsePublishedAppearance, type PublishedAppearance } from "./schema";

function published(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 3, ...patch };
}

test("an appearance stored with layers and custom colours still opens, without them", () => {
  const legacy = published({
    accent: "sea",
    fontSize: 15,
    composition: {
      light: { base: "#c88337", layers: [{ type: "gradient", presetId: "dusk", opacity: 60 }], overrides: { card: "#ffffff" } },
      dark: { base: "#101010", layers: [{ type: "image", id: "wallpaper" }], overrides: {} },
    },
    images: { wallpaper: "data:image/webp;base64,AAAA" },
  });
  const opened = parsePublishedAppearance(legacy)!;
  expect(opened).toMatchObject({ accent: "sea", fontSize: 15, scheme: "system" });
  expect(opened).not.toHaveProperty("composition");
  expect(opened).not.toHaveProperty("images");
});

test("a published appearance is total, gated, and refused only when it is not one", () => {
  const blob: PublishedAppearance = {
    ...parsePublishedAppearance(published())!,
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

  expect(parsePublishedAppearance({ ...blob, version: 2 })).toBeUndefined();
  expect(parsePublishedAppearance("telar")).toBeUndefined();

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
