"use client";

import { useSyncExternalStore } from "react";
import { terminalBridge } from "../bridge";

const subscribe = () => () => {};

/** Whether this client can open a shell: the desktop app on its own Mac. False while server-rendering. */
export function useCanOpenShells(): boolean {
  return useSyncExternalStore(subscribe, () => terminalBridge() !== undefined, () => false);
}
