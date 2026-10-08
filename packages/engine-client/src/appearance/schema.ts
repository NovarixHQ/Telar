export const TELAR_LIGHT: Readonly<Record<string, string>> = {
  background: "oklch(0.975 0.002 286)",
  foreground: "oklch(0.274 0.006 286)",
  card: "oklch(1 0 0)",
  "card-foreground": "oklch(0.274 0.006 286)",
  popover: "oklch(1 0 0)",
  "popover-foreground": "oklch(0.274 0.006 286)",
  secondary: "oklch(0.943 0.002 286)",
  "secondary-foreground": "oklch(0.274 0.006 286)",
  muted: "oklch(0.952 0.001 286)",
  "muted-foreground": "oklch(0.525 0.016 286)",
  accent: "oklch(0.939 0.002 286)",
  "accent-foreground": "oklch(0.21 0.006 286)",
  border: "oklch(0.92 0.004 286)",
  input: "oklch(0.645 0.008 286)",
  sidebar: "oklch(0.955 0.002 286)",
  "sidebar-accent": "oklch(0.938 0.003 286)",
};

export const TELAR_DARK: Readonly<Record<string, string>> = {
  background: "oklch(0.145 0 0)",
  foreground: "oklch(0.97 0 0)",
  card: "oklch(0.2 0 0)",
  "card-foreground": "oklch(0.97 0 0)",
  popover: "oklch(0.225 0 0)",
  "popover-foreground": "oklch(0.97 0 0)",
  secondary: "oklch(0.265 0 0)",
  "secondary-foreground": "oklch(0.97 0 0)",
  muted: "oklch(0.265 0 0)",
  "muted-foreground": "oklch(0.708 0 0)",
  accent: "oklch(0.305 0 0)",
  "accent-foreground": "oklch(0.97 0 0)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(0.53 0 0)",
  sidebar: "oklch(0.175 0 0)",
  "sidebar-accent": "oklch(0.265 0 0)",
};

export const ACCENTS = ["indigo", "sky", "sea", "moss", "amber", "rose", "plum", "violet"] as const;
export type Accent = (typeof ACCENTS)[number];

export const APP_FONTS = [
  "geist",
  "inter",
  "plex-sans",
  "source-sans",
  "roboto",
  "noto-sans",
  "space-grotesk",
  "lato",
  "jetbrains",
  "plex-mono",
  "fira-code",
  "geist-mono",
  "source-code-pro",
  "roboto-mono",
  "cascadia-code",
  "system",
  "custom",
] as const;

export type AppFont = (typeof APP_FONTS)[number];

export const MONOSPACED_FONTS: ReadonlySet<string> = new Set([
  "jetbrains",
  "plex-mono",
  "fira-code",
  "geist-mono",
  "source-code-pro",
  "roboto-mono",
  "cascadia-code",
]);

export const MIN_FONT_SIZE = 13;
export const MAX_FONT_SIZE = 18;

export const MIN_MONO_FONT_SIZE = 11;
export const MAX_MONO_FONT_SIZE = 18;
export const DEFAULT_MONO_FONT_SIZE = 13;

export const MIN_TRANSLUCENCY = 0;
export const MAX_TRANSLUCENCY = 100;

export const DEPTHS = ["soft", "flat", "deep"] as const;
export type Depth = (typeof DEPTHS)[number];
export const DEFAULT_DEPTH: Depth = "soft";

export const CHAT_WIDTHS = ["comfortable", "wide", "full"] as const;
export type ChatWidth = (typeof CHAT_WIDTHS)[number];
export const DEFAULT_CHAT_WIDTH: ChatWidth = "comfortable";

export const DEFAULT_ACCENT: Accent = "indigo";
export const DEFAULT_SANS_FONT: AppFont = "geist";
export const DEFAULT_MONO_FONT: AppFont = "geist";
export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_TRANSLUCENCY_LEVEL = 50;

function isSafeColour(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[;{}<>]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback;
}

/** What every window connected to a host wears: the host's one appearance. */
export type SharedAppearance = {
  accent: Accent;
  fontSans: AppFont;
  fontMono: AppFont;
  fontSansCustom: string;
  fontMonoCustom: string;
  fontSize: number;
  fontMonoSize: number;
  translucencyLevel: number;
  depth: Depth;
};

function parseSharedAppearance(value: Record<string, unknown>): SharedAppearance {
  return {
    accent: oneOf<Accent>(value.accent, ACCENTS, DEFAULT_ACCENT),
    fontSans: oneOf<AppFont>(value.fontSans, APP_FONTS, DEFAULT_SANS_FONT),
    fontMono: oneOf<AppFont>(value.fontMono, APP_FONTS, DEFAULT_MONO_FONT),
    fontSansCustom: typeof value.fontSansCustom === "string" ? value.fontSansCustom : "",
    fontMonoCustom: typeof value.fontMonoCustom === "string" ? value.fontMonoCustom : "",
    fontSize: clampInt(value.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_FONT_SIZE),
    fontMonoSize: clampInt(value.fontMonoSize, MIN_MONO_FONT_SIZE, MAX_MONO_FONT_SIZE, DEFAULT_MONO_FONT_SIZE),
    translucencyLevel: clampInt(value.translucencyLevel, MIN_TRANSLUCENCY, MAX_TRANSLUCENCY, DEFAULT_TRANSLUCENCY_LEVEL),
    depth: oneOf<Depth>(value.depth, DEPTHS, DEFAULT_DEPTH),
  };
}

export type PublishedScheme = "light" | "dark" | "system";
export type PublishedFrost = "blur" | "clear";

/** One accent, as the two tokens globals.css actually sets for it. */
export type PublishedAccentColours = { primary: string; primaryForeground: string };

export type PublishedResolved = {
  accent: { name: Accent; light: PublishedAccentColours; dark: PublishedAccentColours };
  /** Real `font-family` values, not `var(--font-geist-sans)`, so a client can set them. */
  fontStacks: { sans: string; mono: string };
  fontFaces?: string;
};

export type PublishedAppearance = SharedAppearance & {
  version: 3;
  updatedAtHint: number;
  scheme: PublishedScheme;
  translucent: boolean;
  frost: PublishedFrost;
  resolved?: PublishedResolved;
};

function isSafeCssValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[;{}<>]/.test(value);
}

const MAX_FONT_FACES_CHARS = 1024 * 1024;

const isFontFaceCss = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_FONT_FACES_CHARS && /^(?:@font-face\{[^{}<]*\})+$/.test(value);

function parseAccentColours(value: unknown): PublishedAccentColours | undefined {
  if (!isRecord(value) || !isSafeColour(value.primary) || !isSafeColour(value.primaryForeground)) return undefined;
  return { primary: value.primary, primaryForeground: value.primaryForeground };
}

function parseResolved(value: unknown): PublishedResolved | undefined {
  if (!isRecord(value)) return undefined;
  const accent = isRecord(value.accent) ? value.accent : undefined;
  const light = parseAccentColours(accent?.light);
  const dark = parseAccentColours(accent?.dark);
  const stacks = isRecord(value.fontStacks) ? value.fontStacks : undefined;
  if (!light || !dark || !isSafeCssValue(stacks?.sans) || !isSafeCssValue(stacks?.mono)) return undefined;
  return {
    accent: { name: oneOf<Accent>(accent?.name, ACCENTS, DEFAULT_ACCENT), light, dark },
    fontStacks: { sans: stacks.sans, mono: stacks.mono },
    ...(isFontFaceCss(value.fontFaces) ? { fontFaces: value.fontFaces } : {}),
  };
}

export function parsePublishedAppearance(value: unknown): PublishedAppearance | undefined {
  if (!isRecord(value) || value.version !== 3) return undefined;
  const resolved = parseResolved(value.resolved);
  return {
    ...parseSharedAppearance(value),
    version: 3,
    updatedAtHint: typeof value.updatedAtHint === "number" && Number.isFinite(value.updatedAtHint) ? value.updatedAtHint : 0,
    scheme: oneOf<PublishedScheme>(value.scheme, ["light", "dark", "system"], "system"),
    translucent: value.translucent === true,
    frost: oneOf<PublishedFrost>(value.frost, ["blur", "clear"], "blur"),
    ...(resolved ? { resolved } : {}),
  };
}
