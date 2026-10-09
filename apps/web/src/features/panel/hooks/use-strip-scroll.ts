import { useCallback, useEffect, useRef, useState } from "react";

const EDGE = 1;

type StripScroll = { overflow: boolean; back: boolean; forward: boolean };

export function useStripScroll(tabCount: number) {
  const viewport = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<StripScroll>({ overflow: false, back: false, forward: false });

  const measure = useCallback(() => {
    const strip = viewport.current;
    if (!strip) return;
    const overflow = strip.scrollWidth - strip.clientWidth > EDGE;
    const next = {
      overflow,
      back: overflow && strip.scrollLeft > EDGE,
      forward: overflow && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - EDGE,
    };
    setState((current) => (current.overflow === next.overflow && current.back === next.back && current.forward === next.forward ? current : next));
  }, []);

  useEffect(() => {
    const strip = viewport.current;
    if (!strip) return;
    measure();
    strip.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(strip);
    return () => {
      strip.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure, tabCount]);

  const step = useCallback(
    (direction: -1 | 1) => {
      const strip = viewport.current;
      if (!strip || tabCount === 0) return;
      const end = strip.scrollWidth - strip.clientWidth;
      strip.scrollLeft = Math.min(end, Math.max(0, strip.scrollLeft + direction * (strip.scrollWidth / tabCount)));
      measure();
    },
    [measure, tabCount],
  );

  return { viewport, ...state, step };
}
