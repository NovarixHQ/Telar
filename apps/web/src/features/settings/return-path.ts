"use client";

import { useSyncExternalStore } from "react";

const KEY = "telar:settings-return";
const NOT_COCKPIT = /^\/pair(?:[/?#]|$)/;

export function rememberSettingsReturn(path: string): void {
  if (NOT_COCKPIT.test(path)) return;
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {}
}

function readReturnPath(): string {
  try {
    return window.sessionStorage.getItem(KEY) ?? "/";
  } catch {
    return "/";
  }
}

export function useSettingsReturnPath(): string {
  return useSyncExternalStore(
    () => () => {},
    readReturnPath,
    () => "/",
  );
}
