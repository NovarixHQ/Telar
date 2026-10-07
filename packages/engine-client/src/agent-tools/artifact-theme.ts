export type ArtifactTheme = { scheme: "light" | "dark"; variables: Record<string, string> };

export const ARTIFACT_THEME_TOKENS = [
  ["background", "--background"],
  ["foreground", "--foreground"],
  ["card", "--card"],
  ["card-foreground", "--card-foreground"],
  ["muted", "--muted"],
  ["muted-foreground", "--muted-foreground"],
  ["border", "--border"],
  ["primary", "--primary"],
  ["primary-foreground", "--primary-foreground"],
  ["secondary", "--secondary"],
  ["secondary-foreground", "--secondary-foreground"],
  ["accent", "--accent"],
  ["accent-foreground", "--accent-foreground"],
  ["success", "--success"],
  ["warning", "--warning"],
  ["info", "--info"],
  ["destructive", "--destructive"],
  ["chart-1", "--chart-1"],
  ["chart-2", "--chart-2"],
  ["chart-3", "--tint-green"],
  ["chart-4", "--tint-orange"],
  ["chart-5", "--tint-cyan"],
  ["chart-6", "--tint-yellow"],
  ["code-background", "--muted"],
  ["code-foreground", "--foreground"],
  ["code-comment", "--muted-foreground"],
  ["code-keyword", "--primary"],
  ["code-string", "--success"],
  ["code-number", "--warning"],
  ["code-function", "--info"],
  ["radius", "--radius"],
  ["font-sans", "--app-font-sans"],
  ["font-mono", "--app-font-mono"],
] as const;

const NOT_COLOURS = new Set(["radius", "font-sans", "font-mono"]);

const unsafe = /[;{}<>\\]/g;

const channel = (raw: string, full: number) => (raw === "none" ? 0 : raw.endsWith("%") ? (Number.parseFloat(raw) / 100) * full : Number.parseFloat(raw));

const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function oklabToRgb(l: number, a: number, b: number): [number, number, number] {
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gamma(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    gamma(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    gamma(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

export function cssColorToHex(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3,4})$/.exec(text);
  if (short) return `#${[...short[1]!].map((digit) => digit + digit).join("")}`.replace(/^(#[0-9a-f]{6})ff$/, "$1");
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(text)) return text.replace(/^(#[0-9a-f]{6})ff$/, "$1");
  const call = /^(rgba?|oklch|oklab|color)\((.*)\)$/.exec(text);
  if (!call) return undefined;
  const [main = "", slashAlpha] = call[2]!.split("/");
  const parts = main.trim().split(/\s*,\s*|\s+/);
  if (call[1] === "color" && parts.shift() !== "srgb") return undefined;
  const [x = "", y = "", z = "", commaAlpha] = parts;
  const alpha = Math.min(1, channel((slashAlpha ?? commaAlpha ?? "1").trim(), 1));
  let rgb: [number, number, number];
  if (call[1] === "oklch") {
    const hue = (channel(z, 1) * Math.PI) / 180;
    const chroma = channel(y, 0.4);
    rgb = oklabToRgb(channel(x, 1), chroma * Math.cos(hue), chroma * Math.sin(hue));
  } else if (call[1] === "oklab") rgb = oklabToRgb(channel(x, 1), channel(y, 0.4), channel(z, 0.4));
  else if (call[1] === "color") rgb = [channel(x, 1), channel(y, 1), channel(z, 1)];
  else rgb = [channel(x, 255) / 255, channel(y, 255) / 255, channel(z, 255) / 255];
  if (![...rgb, alpha].every(Number.isFinite)) return undefined;
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${rgb.map(byte).join("")}${alpha < 1 ? byte(alpha) : ""}`;
}

const rgbOf = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];

const luminance = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const opaque = (value: string | undefined): value is string => value !== undefined && /^#[0-9a-f]{6}$/.test(value);

function mixHex(from: string, to: string, amount: number): string {
  const [a, b] = [rgbOf(from), rgbOf(to)];
  return `#${a.map((v, i) => Math.round((v + (b[i]! - v) * amount) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const CHART_CONTRAST = 3;

function legibleChart(colour: string, grounds: string[], ink: string): string {
  for (let step = 0; step <= 10; step++) {
    const candidate = mixHex(colour, ink, step / 10);
    if (grounds.every((ground) => contrastRatio(candidate, ground) >= CHART_CONTRAST)) return candidate;
  }
  return ink;
}

type ThemeOptions = { paint?: (token: string) => string | undefined; canvas?: string };

export function artifactTheme(scheme: ArtifactTheme["scheme"], read: (token: string) => string, { paint, canvas }: ThemeOptions = {}): ArtifactTheme {
  const variables: Record<string, string> = {};
  for (const [name, token] of ARTIFACT_THEME_TOKENS) {
    const value = NOT_COLOURS.has(name) ? read(token).trim().replace(unsafe, "") : (paint?.(token) ?? cssColorToHex(read(token)));
    if (value) variables[`--${name}`] = value;
  }
  const ink = variables["--foreground"];
  const grounds = [variables["--background"], variables["--card"]].filter(opaque);
  if (opaque(ink) && grounds.length > 0) {
    for (let series = 1; series <= 6; series++) {
      const name = `--chart-${series}`;
      const colour = variables[name];
      if (opaque(colour)) variables[name] = legibleChart(colour, grounds, ink);
    }
  }
  if (canvas) variables["--background"] = canvas;
  return { scheme, variables };
}

export function artifactThemeCss(theme: ArtifactTheme): string {
  const variables = theme.variables || {};
  const lines = Object.keys(variables)
    .filter((name) => /^--[a-z0-9-]+$/.test(name))
    .map((name) => name + ":" + String(variables[name]).replace(/[;{}<>\\]/g, "") + ";");
  return ":where(:root){color-scheme:" + (theme.scheme === "dark" ? "dark" : "light") + ";" + lines.join("") + "}";
}

const MERMAID_TOKENS: Record<string, string> = {
  background: "background",
  primaryColor: "card",
  primaryTextColor: "card-foreground",
  primaryBorderColor: "primary",
  secondaryColor: "muted",
  secondaryTextColor: "foreground",
  secondaryBorderColor: "border",
  tertiaryColor: "accent",
  tertiaryTextColor: "foreground",
  tertiaryBorderColor: "border",
  mainBkg: "card",
  nodeBorder: "primary",
  clusterBkg: "muted",
  clusterBorder: "border",
  lineColor: "muted-foreground",
  textColor: "foreground",
  titleColor: "foreground",
  edgeLabelBackground: "background",
  noteBkgColor: "accent",
  noteTextColor: "accent-foreground",
  noteBorderColor: "border",
  actorBkg: "card",
  actorBorder: "primary",
  actorTextColor: "card-foreground",
  signalColor: "foreground",
  signalTextColor: "foreground",
  errorBkgColor: "destructive",
  errorTextColor: "background",
  pie1: "chart-1",
  pie2: "chart-2",
  pie3: "chart-3",
  pie4: "chart-4",
  pie5: "chart-5",
  pie6: "chart-6",
};

export function mermaidThemeVariables(theme: ArtifactTheme): Record<string, string | boolean> {
  const variables: Record<string, string | boolean> = { darkMode: theme.scheme === "dark" };
  for (const [key, name] of Object.entries(MERMAID_TOKENS)) {
    const value = theme.variables[`--${name}`];
    const ground = name === "background" && !opaque(value) ? theme.variables["--card"] : value;
    if (opaque(ground)) variables[key] = ground;
  }
  return variables;
}
