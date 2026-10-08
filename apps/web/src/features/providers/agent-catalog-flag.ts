"use client";

import { useSyncExternalStore } from "react";

const KEY = "telar:experimental:agent-catalog";

// Until Settings has an Experimental group, `?experimental=agent-catalog` turns the catalog on for this device and `=off` turns it off.
function enabled(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get("experimental");
    if (asked === "agent-catalog") window.localStorage.setItem(KEY, "1");
    if (asked === "off") window.localStorage.removeItem(KEY);
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

export const useAgentCatalogEnabled = (): boolean => useSyncExternalStore(subscribe, enabled, () => false);
