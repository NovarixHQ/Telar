import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export const MAX_FOLD = 2;

export function nextFold(fold: number, width: number, cut: number, needs: readonly number[]): { fold: number; need?: number } {
  if (cut > 0 && fold < MAX_FOLD) return { fold: fold + 1, need: width + cut };
  if (fold > 0 && cut === 0 && width >= (needs[fold - 1] ?? Infinity)) return { fold: fold - 1 };
  return { fold };
}

function cutShort(row: HTMLElement): number {
  let cut = 0;
  for (const label of row.querySelectorAll("span")) {
    if (label.childElementCount === 0) cut += Math.max(0, label.scrollWidth - label.clientWidth);
  }
  return cut;
}

export function usePillFold(): [RefObject<HTMLDivElement | null>, number] {
  const row = useRef<HTMLDivElement>(null);
  const needs = useRef<number[]>([]);
  const [fold, setFold] = useState(0);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const next = nextFold(fold, element.clientWidth, cutShort(element), needs.current);
      if (next.need !== undefined) needs.current[fold] = next.need;
      setFold(next.fold);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  });

  return [row, fold];
}
