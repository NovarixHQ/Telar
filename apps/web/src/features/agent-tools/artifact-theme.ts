"use client";

import { useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { ARTIFACT_NOT_COLOURS, ARTIFACT_THEME_TOKENS, artifactTheme, cssColorToHex, type ArtifactTheme } from "@telar/engine-client";

let paintCanvas: HTMLCanvasElement | undefined;

function paintedHex(value: string): string | undefined {
  if (paintCanvas?.ownerDocument !== document) paintCanvas = document.createElement("canvas");
  const context = paintCanvas.getContext?.("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.fillStyle = "#010203";
  context.fillStyle = value;
  if (context.fillStyle === "#010203" && cssColorToHex(value) !== "#010203") return undefined;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return cssColorToHex(`rgb(${r} ${g} ${b} / ${a / 255})`);
}

const MISSING = "#010203";

const COLOUR_TOKENS = ARTIFACT_THEME_TOKENS.filter(([name]) => !ARTIFACT_NOT_COLOURS.has(name)).map(([, token]) => token);

function colourTokensIn(host: Element): Map<string, string | undefined> {
  const probes = COLOUR_TOKENS.map((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token}-wash, var(${token}, ${MISSING}))`;
    return probe;
  });
  host.append(...probes);
  const computed = probes.map((probe) => getComputedStyle(probe).color);
  for (const probe of probes) probe.remove();
  return new Map(
    COLOUR_TOKENS.map((token, index) => {
      const hex = cssColorToHex(computed[index]!) ?? paintedHex(computed[index]!);
      return [token, hex === MISSING ? undefined : hex];
    }),
  );
}

const TRANSPARENT = /^#[0-9a-f]{6}00$/;

function canvasBehind(host: Element): string {
  for (let node: Element | null = host; node; node = node.parentElement) {
    const painted = getComputedStyle(node).backgroundColor;
    const hex = painted ? (cssColorToHex(painted) ?? paintedHex(painted)) : undefined;
    if (!hex || TRANSPARENT.test(hex)) continue;
    return hex.length === 7 ? hex : "transparent";
  }
  return "transparent";
}

function readArtifactTheme(host: Element): ArtifactTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const painted = colourTokensIn(host);
  const canvas = canvasBehind(host);
  return artifactTheme(root.classList.contains("dark") ? "dark" : "light", (token) => style.getPropertyValue(token), { paint: (token) => painted.get(token), canvas });
}

const SERVER_THEME = JSON.stringify({ scheme: "light", variables: {} } satisfies ArtifactTheme);

function themeStore(host?: RefObject<Element | null>) {
  let cached: { at: Element; json: string } | undefined;
  return {
    subscribe(onChange: () => void) {
      const observer = new MutationObserver(() => {
        cached = undefined;
        onChange();
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    },
    snapshot: () => {
      const at = host?.current?.parentElement ?? document.body;
      if (cached?.at !== at) cached = { at, json: JSON.stringify(readArtifactTheme(at)) };
      return cached.json;
    },
  };
}

export function useArtifactTheme(host?: RefObject<Element | null>): ArtifactTheme {
  const [store] = useState(() => themeStore(host));
  const json = useSyncExternalStore(store.subscribe, store.snapshot, () => SERVER_THEME);
  return useMemo(() => JSON.parse(json) as ArtifactTheme, [json]);
}
