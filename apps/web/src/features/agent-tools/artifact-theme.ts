"use client";

import { useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { artifactTheme, cssColorToHex, type ArtifactTheme } from "@telar/engine-client";

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

function colourIn(host: Element, value: string): string | undefined {
  const probe = document.createElement("span");
  probe.style.color = value;
  host.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return cssColorToHex(computed) ?? paintedHex(computed);
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
  const paint = (token: string) => {
    const hex = colourIn(host, `var(${token}-wash, var(${token}, ${MISSING}))`);
    return hex === MISSING ? undefined : hex;
  };
  return artifactTheme(root.classList.contains("dark") ? "dark" : "light", (token) => style.getPropertyValue(token), { paint, canvas: canvasBehind(host) });
}

const SERVER_THEME = JSON.stringify({ scheme: "light", variables: {} } satisfies ArtifactTheme);

function themeStore(host?: RefObject<Element | null>) {
  let cached: string | undefined;
  return {
    subscribe(onChange: () => void) {
      const observer = new MutationObserver(() => {
        cached = undefined;
        onChange();
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
      cached = undefined;
      onChange();
      return () => observer.disconnect();
    },
    snapshot: () => (cached ??= JSON.stringify(readArtifactTheme(host?.current?.parentElement ?? document.body))),
  };
}

export function useArtifactTheme(host?: RefObject<Element | null>): ArtifactTheme {
  const [store] = useState(() => themeStore(host));
  const json = useSyncExternalStore(store.subscribe, store.snapshot, () => SERVER_THEME);
  return useMemo(() => JSON.parse(json) as ArtifactTheme, [json]);
}
