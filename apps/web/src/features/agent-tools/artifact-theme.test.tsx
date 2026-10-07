import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { ARTIFACT_NOT_COLOURS, ARTIFACT_THEME_TOKENS, cssColorToHex, type ArtifactTheme } from "@telar/engine-client";
import { ACCENTS } from "@/features/appearance";
import { installTestDom, mount } from "@/test/dom";
import { useArtifactTheme } from "./artifact-theme";
import { artifactDocument } from "./artifacts";

installTestDom();

const LOOK_SELECTOR = /^(:root|\.dark|html:not\(\.dark\)|html:root|\[data-accent|\.dark\[data-accent|\[data-depth|:is\(\[data-telar-shell\])/;

function lookRules(css: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: string[] = [];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf("{", at);
    if (open === -1) break;
    const selector = source.slice(at, open).trim();
    let depth = 1;
    let close = open + 1;
    for (; close < source.length && depth > 0; close++) depth += source[close] === "{" ? 1 : source[close] === "}" ? -1 : 0;
    const rule = selector === "@theme" ? ":root" : selector;
    if (!rule.startsWith("@") && LOOK_SELECTOR.test(rule)) rules.push(`${rule}{${source.slice(open + 1, close - 1)}}`);
    at = close;
  }
  return rules.join("\n");
}

const GLOBALS = lookRules(fs.readFileSync(path.join(import.meta.dir, "../../app/globals.css"), "utf8"));

function Probe() {
  return <output>{JSON.stringify(useArtifactTheme())}</output>;
}

type Setup = { dark: boolean; accent?: string; scene?: "translucent" | "backdrop" };

function applyLook(setup: Setup) {
  const root = document.documentElement;
  root.className = setup.dark ? "dark" : "";
  for (const [name, value] of [["data-accent", setup.accent], ["data-backdrop", setup.scene === "backdrop" ? "scene" : undefined]] as const) {
    if (value) root.setAttribute(name, value);
    else root.removeAttribute(name);
  }
  for (const name of ["data-telar-shell", "data-translucent"]) {
    if (setup.scene === "translucent") root.setAttribute(name, "");
    else root.removeAttribute(name);
  }
  document.body.style.backgroundColor = setup.scene ? "rgba(10, 10, 10, 0.55)" : cssColorToHex(getComputedStyle(root).getPropertyValue("--background"))!;
}

const COLOR_MIX_ONLY = new Set(["overlay"]);
const COLOURS = ARTIFACT_THEME_TOKENS.filter(([name]) => !ARTIFACT_NOT_COLOURS.has(name) && !COLOR_MIX_ONLY.has(name)).map(([name]) => `--${name}`);

test("every Look reaches an artifact as real colours and shadows, with its scheme stated on the page", async () => {
  const sheet = document.createElement("style");
  sheet.textContent = GLOBALS;
  document.head.append(sheet);
  const { host } = await mount(<Probe />);
  const setups = [false, true].flatMap((dark) => [undefined, ...ACCENTS].flatMap((accent) => [undefined, "translucent", "backdrop"].map((scene) => ({ dark, accent, scene }) as Setup)));
  try {
    for (const setup of setups) {
      await act(async () => applyLook(setup));
      const theme = JSON.parse(host.querySelector("output")!.textContent!) as ArtifactTheme;
      const label = JSON.stringify(setup);
      const scheme = setup.dark ? "dark" : "light";
      expect(`${label} ${theme.scheme}`).toBe(`${label} ${scheme}`);
      const page = new DOMParser().parseFromString(artifactDocument("<html lang='en'><p>x</p>", "f1", theme), "text/html");
      expect(`${label} ${page.documentElement.dataset.scheme}`).toBe(`${label} ${scheme}`);
      expect(page.querySelector("style")!.textContent).toStartWith(`:where(:root){color-scheme:${scheme};--scheme:${scheme};`);
      for (const rung of ["--shadow-1", "--shadow-2", "--shadow-3"]) expect(`${label} ${rung}=${theme.variables[rung]}`).toMatch(/=0 \S+px .*color-mix\(.*\)$/);
      expect(Object.values(theme.variables).join(" ")).not.toContain("var(");
      for (const name of COLOURS) {
        const value = theme.variables[name];
        expect(`${label} ${name}=${value}`).toMatch(name === "--background" && setup.scene ? /=transparent$/ : /=#[0-9a-f]{6}([0-9a-f]{2})?$/);
        expect(`${label} ${name}=${value}`).not.toMatch(/=#000000(00)?$/);
      }
    }
  } finally {
    applyLook({ dark: false });
    document.body.style.removeProperty("background-color");
    await act(async () => sheet.remove());
  }
});
