import { expect, test } from "bun:test";
import { ARTIFACT_THEME_TOKENS, artifactTheme, artifactThemeCss, cssColorToHex, mermaidThemeVariables } from "./artifact-theme";

test("every colour form a Look or a browser produces comes out as hex", () => {
  expect(cssColorToHex("oklch(1 0 0)")).toBe("#ffffff");
  expect(cssColorToHex("oklch(0 0 0)")).toBe("#000000");
  expect(cssColorToHex("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
  expect(cssColorToHex("oklch(62.8% 0.2577 29.23deg / 50%)")).toBe("#ff000080");
  expect(cssColorToHex("oklab(0.52 -0.14 0.107)")).toMatch(/^#[0-9a-f]{6}$/);
  expect(cssColorToHex("rgb(1, 2, 3)")).toBe("#010203");
  expect(cssColorToHex("rgba(255, 0, 0, 0.5)")).toBe("#ff000080");
  expect(cssColorToHex("rgb(255 255 255 / 1)")).toBe("#ffffff");
  expect(cssColorToHex("color(srgb 0 0.5 1)")).toBe("#0080ff");
  expect(cssColorToHex("#ABC")).toBe("#aabbcc");
  expect(cssColorToHex("#112233ff")).toBe("#112233");
});

test("what is not a colour it can read is refused rather than guessed", () => {
  for (const value of ["", "red", "color-mix(in oklab, red, blue)", "var(--x)", "oklch(a b c)", "color(display-p3 1 0 0)"]) expect(cssColorToHex(value)).toBeUndefined();
});

test("the theme reads every token, converts the colours, and resolves what it cannot convert", () => {
  const look: Record<string, string> = { "--background": "oklch(0.975 0.002 286)", "--primary": "color-mix(in oklab, red, blue)", "--radius": "0.625rem", "--app-font-sans": '"Geist", ui-sans-serif' };
  const theme = artifactTheme("dark", (token) => look[token] ?? "", () => "rgb(128, 0, 128)");
  expect(theme.scheme).toBe("dark");
  expect(theme.variables["--background"]).toMatch(/^#[0-9a-f]{6}$/);
  expect(theme.variables["--primary"]).toBe("#800080");
  expect(theme.variables["--code-keyword"]).toBe("#800080");
  expect(theme.variables["--radius"]).toBe("0.625rem");
  expect(theme.variables["--font-sans"]).toBe('"Geist", ui-sans-serif');
  expect(theme.variables).not.toHaveProperty("--foreground");
  expect(Object.values(theme.variables).some((value) => value.includes("oklch"))).toBe(false);
});

test("every name in the list is a distinct variable", () => {
  const names = ARTIFACT_THEME_TOKENS.map(([name]) => name);
  expect(new Set(names).size).toBe(names.length);
});

test("the css loses to the page's own rules and cannot escape its block", () => {
  const css = artifactThemeCss({ scheme: "dark", variables: { "--background": "#111111", "--font-sans": "x}</style><script>", "bad name": "#000" } });
  expect(css).toStartWith(":where(:root){color-scheme:dark;--background:#111111;");
  expect(css).not.toMatch(/[<>]|bad name/);
  expect(css.match(/[{}]/g)).toEqual(["{", "}"]);
});

test("mermaid is themed from the Look's colours, not only light or dark", () => {
  const theme = artifactTheme("dark", (token) => ({ "--card": "#222222", "--primary": "#3366ff", "--chart-1": "#ff8800", "--muted-foreground": "#999999" })[token] ?? "");
  expect(mermaidThemeVariables(theme)).toMatchObject({ darkMode: true, primaryColor: "#222222", mainBkg: "#222222", primaryBorderColor: "#3366ff", lineColor: "#999999", pie1: "#ff8800" });
  expect(mermaidThemeVariables(theme)).not.toHaveProperty("textColor");
});
