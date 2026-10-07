"use client";

import { useSyncExternalStore } from "react";

const KEY = "telar:settings-return";

export function rememberSettingsReturn(path: string): void {
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
