import { font, foregroundStyle, kerning, textCase } from "@expo/ui/swift-ui/modifiers";
import { DynamicColorIOS, type ColorValue } from "react-native";

type Pair = { light: string; dark: string };

/** The Swift app's adaptive palette as light/dark hex pairs. */
export const palette = {
  canvas: { light: "#FCFCFC", dark: "#0A0A0A" },
  card: { light: "#FFFFFF", dark: "#161616" },
  sheet: { light: "#F6F6F6", dark: "#101010" },
  fill: { light: "#F4F4F5", dark: "#252525" },
  subtle: { light: "#F1F1F3", dark: "#252525" },
  subtleStrong: { light: "#F0F0F1", dark: "#2F2F2F" },
  popover: { light: "#FFFFFF", dark: "#1C1C1C" },
  codeBackground: { light: "#F4F4F5", dark: "#252525" },
  text: { light: "#27272A", dark: "#F5F5F5" },
  textMuted: { light: "#696973", dark: "#A1A1A1" },
  border: { light: "#E4E4E7", dark: "#FFFFFF1A" },
  accent: { light: "#2F58B9", dark: "#6594FA" },
  accentGlyph: { light: "#FFFFFF", dark: "#070F21" },
  amber: { light: "#8E5B01", dark: "#F2A635" },
  sky: { light: "#007386", dark: "#22BEDC" },
  emerald: { light: "#02744E", dark: "#2AC48A" },
  red: { light: "#B71822", dark: "#FF645E" },
} satisfies Record<string, Pair>;

export type ThemeColor = keyof typeof palette;

function withAlpha(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const base = hex.length === 9 ? hex.slice(0, 7) : hex;
  const existing = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  const alpha = Math.round(existing * opacity * 255).toString(16).padStart(2, "0").toUpperCase();
  return `${base}${alpha}`;
}

/** A palette colour at an opacity, still adapting to light and dark. */
export function faded(name: ThemeColor, opacity: number): ColorValue {
  const { light, dark } = palette[name];
  return DynamicColorIOS({ light: withAlpha(light, opacity), dark: withAlpha(dark, opacity) });
}

export const Theme = Object.fromEntries(Object.entries(palette).map(([name, pair]) => [name, DynamicColorIOS(pair)])) as Record<ThemeColor, ColorValue>;

export const Radius = { control: 8, row: 8, card: 14, statusCard: 16, primaryButton: 16, bubble: 18, composer: 22, settingsCard: 24 } as const;

/** Swift's Dynamic Type styles, as `font` modifiers. */
export const Type = {
  body: font({ textStyle: "body" }),
  bodyMedium: font({ textStyle: "body", weight: "medium" }),
  rowTitle: font({ textStyle: "subheadline", weight: "medium" }),
  slim: font({ textStyle: "footnote" }),
  slimMedium: font({ textStyle: "footnote", weight: "medium" }),
  groupHeader: font({ textStyle: "footnote", weight: "semibold" }),
  meta: font({ textStyle: "caption" }),
  metaSmall: font({ textStyle: "caption2" }),
  metaSmallMedium: font({ textStyle: "caption2", weight: "medium" }),
  mono: font({ textStyle: "caption", design: "monospaced" }),
  monoSmall: font({ textStyle: "caption2", design: "monospaced" }),
} as const;

/** Uppercase caption2 semibold, tracked 0.6, muted: section bands like "Needs you". */
export const bandCaption = [font({ textStyle: "caption2", weight: "semibold" }), textCase("uppercase"), kerning(0.6), foregroundStyle(Theme.textMuted)];
