// Ported from apps/ios ArtifactDocument.swift: the page an artifact is drawn in, wearing the app's look.
type Scheme = "light" | "dark";
type Pair = { light: string; dark: string };
type Palette = Record<"canvas" | "text" | "card" | "popover" | "subtle" | "textMuted" | "border" | "accent" | "accentGlyph" | "subtleStrong" | "sheet" | "emerald" | "amber" | "sky" | "red" | "codeBackground", Pair>;
const pair = (dark: string, light: string): Pair => ({ dark, light });

const tokens = (palette: Palette): [string, Pair][] => [
  ["background", palette.canvas], ["foreground", palette.text], ["card", palette.card], ["card-foreground", palette.text],
  ["popover", palette.popover], ["popover-foreground", palette.text], ["muted", palette.subtle], ["muted-foreground", palette.textMuted],
  ["border", palette.border], ["primary", palette.accent], ["primary-foreground", palette.accentGlyph], ["secondary", palette.subtle],
  ["secondary-foreground", palette.text], ["accent", palette.subtleStrong], ["accent-foreground", palette.text], ["input", pair("#6C6C6C", "#8D8D92")],
  ["ring", palette.accent], ["overlay", pair("#0A0A0A8C", "#27272A1A")], ["sidebar", palette.sheet], ["sidebar-foreground", palette.text],
  ["sidebar-primary", palette.accent], ["sidebar-accent", palette.subtle], ["sidebar-accent-foreground", palette.text], ["sidebar-border", palette.border],
  ["sidebar-ring", palette.accent], ["success", palette.emerald], ["warning", palette.amber], ["info", palette.sky], ["destructive", palette.red],
  ["code-background", palette.codeBackground], ["code-foreground", palette.text], ["code-comment", palette.textMuted], ["code-keyword", palette.accent],
  ["code-string", palette.emerald], ["code-number", palette.amber], ["code-function", palette.sky],
  ["tint-blue", pair("#5DB2F7", "#007AC5")], ["tint-cyan", pair("#4FBEC4", "#01858A")], ["tint-green", pair("#55C483", "#1A8A51")],
  ["tint-yellow", pair("#E4B33F", "#9B7300")], ["tint-orange", pair("#F89A56", "#B75F0B")], ["tint-red", pair("#FB8083", "#C0434C")],
  ["tint-pink", pair("#F080B8", "#B54481")], ["tint-purple", pair("#B394FF", "#7D5CC7")],
  ["chart-1", pair("#81A9FD", "#436ED1")], ["chart-2", pair("#E584CF", "#A84D95")], ["chart-3", pair("#55C483", "#1A8A51")],
  ["chart-4", pair("#F89A56", "#B75F0B")], ["chart-5", pair("#4FBEC4", "#01858A")], ["chart-6", pair("#E4B33F", "#9B7300")],
];

function shadows(scheme: Scheme): [string, string][] {
  const [ring, ambient, lift] = scheme === "dark" ? ["rgb(0 0 0 / 0.33)", "rgb(0 0 0 / 0.08)", 0.5] : ["rgb(39 39 42 / 0.1)", "rgb(39 39 42 / 0.23)", 1];
  const rung = (contact: string, y: number, blur: number, spread: number) => `0 ${contact} ${ring}, 0 ${y * lift}px ${blur * lift}px ${spread * lift}px ${ambient}`;
  return [["shadow-1", rung("1px 1px -1px", 2, 6, -4)], ["shadow-2", rung("1px 2px -1px", 8, 24, -14)], ["shadow-3", rung("2px 4px -2px", 18, 48, -26)]];
}

function style(scheme: Scheme, palette: Palette): string {
  const variables = [
    ...tokens(palette).map(([name, colors]): [string, string] => [name, colors[scheme].toLowerCase()]),
    ...shadows(scheme),
    ["radius", "10px"],
    ["font-sans", "-apple-system, system-ui, sans-serif"],
    ["font-mono", "ui-monospace, SFMono-Regular, Menlo, monospace"],
  ].map(([name, value]) => `--${name}:${value};`).join("");
  return `:where(:root){color-scheme:${scheme};--scheme:${scheme};${variables}}`
    + ":where(html){background:var(--background);color:var(--foreground);font:15px/1.5 var(--font-sans);-webkit-text-size-adjust:100%}:where(body){margin:0}";
}

export function artifactHtml(content: string, kind: string, scheme: Scheme, palette: Palette): string {
  const body = content.replace(/^\s*<!doctype[^>]*>/i, "");
  const fit = kind === "svg" ? "<style>:where(svg){display:block;max-width:100%;height:auto;margin:0 auto}</style>" : "";
  return `<!doctype html><html data-scheme="${scheme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style id="telar-look">${style(scheme, palette)}</style>${fit}${body}`;
}

/** Posts the page's content height, and whether it is wider than the frame, on every change. */
export const ARTIFACT_PROBE = `(() => {
  const measure = () => {
    const body = document.body;
    if (!body) return 0;
    const style = getComputedStyle(body);
    let bottom = 0, last = null;
    for (const child of body.children) {
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      if (child.checkVisibility && !child.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const edge = child.getBoundingClientRect().bottom;
      if (edge >= bottom) { bottom = edge; last = child; }
    }
    for (const node of body.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNode(node);
      bottom = Math.max(bottom, range.getBoundingClientRect().bottom);
    }
    const tail = [last ? getComputedStyle(last).marginBottom : "0", style.paddingBottom, style.borderBottomWidth, style.marginBottom]
      .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
    return bottom + scrollY + tail;
  };
  const post = () => {
    const root = document.documentElement;
    window.ReactNativeWebView.postMessage(JSON.stringify({ height: measure(), wide: root.scrollWidth > root.clientWidth + 1 }));
  };
  const watch = new ResizeObserver(post);
  watch.observe(document.documentElement);
  if (document.body) {
    watch.observe(document.body);
    new MutationObserver(post).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  addEventListener("load", post);
  document.fonts.ready.then(post);
  post();
})(); true;`;

export type Probe = { height: number; wide: boolean };

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 560;
const RESTING_HEIGHT = 160;

const cap = (hint?: number) => (hint === undefined ? MAX_HEIGHT : Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, hint)));

/** The card's height: what the page measured, within the agent's hint and the 48–560pt band. */
export function artifactHeight(probe: Probe | undefined, hint?: number): number {
  if (!probe || !Number.isFinite(probe.height)) return hint === undefined ? RESTING_HEIGHT : cap(hint);
  return Math.min(cap(hint), Math.max(MIN_HEIGHT, Math.ceil(probe.height)));
}

/** The page scrolls inside its card only when it is wider than it, or taller than the cap. */
export const artifactScrolls = (probe: Probe | undefined, hint?: number) => Boolean(probe && (probe.wide || probe.height > cap(hint)));

export function parseProbe(message: string): Probe | undefined {
  try {
    const value = JSON.parse(message) as { height?: unknown; wide?: unknown };
    return typeof value.height === "number" && Number.isFinite(value.height) && value.height >= 0 ? { height: Math.ceil(value.height), wide: value.wide === true } : undefined;
  } catch {
    return undefined;
  }
}
