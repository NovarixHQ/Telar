"use client";

import { useEffect, useState } from "react";

type Box = { width: number; height: number };

export function useBox(element: HTMLElement | null): Box {
  const [observed, setObserved] = useState<Box>();
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setObserved({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return observed ?? { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 };
}
