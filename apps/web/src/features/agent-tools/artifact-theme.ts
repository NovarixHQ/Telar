"use client";

import { useMemo, useSyncExternalStore } from "react";
import { artifactTheme, type ArtifactTheme } from "@telar/engine-client";

let cached: string | undefined;
let watchers = 0;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(() => {
    cached = undefined;
    onChange();
  });
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  watchers += 1;
  return () => {
    observer.disconnect();
    watchers -= 1;
    cached = undefined;
  };
}

function resolveColour(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function readArtifactTheme(): ArtifactTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return artifactTheme(root.classList.contains("dark") ? "dark" : "light", (token) => style.getPropertyValue(token), resolveColour);
}

const snapshot = () => (watchers > 0 ? (cached ??= JSON.stringify(readArtifactTheme())) : JSON.stringify(readArtifactTheme()));

const SERVER_THEME = JSON.stringify({ scheme: "light", variables: {} } satisfies ArtifactTheme);

export function useArtifactTheme(): ArtifactTheme {
  const json = useSyncExternalStore(subscribe, snapshot, () => SERVER_THEME);
  return useMemo(() => JSON.parse(json) as ArtifactTheme, [json]);
}
