"use client";

import { useSyncExternalStore } from "react";
import { terminalBridge } from "../bridge";

const subscribe = () => () => {};

export function useCanOpenShells(): boolean {
  return useSyncExternalStore(subscribe, () => terminalBridge() !== undefined, () => false);
}
