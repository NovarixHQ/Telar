import { useLayoutEffect, useState, type RefObject } from "react";

const NARROW_COMPOSER_PX = 448;
const WIDE_AGAIN_PX = NARROW_COMPOSER_PX + 16;

export function useNarrowComposer(box: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = element.clientWidth;
      if (width === 0) return;
      setNarrow((was) => (was ? width < WIDE_AGAIN_PX : width < NARROW_COMPOSER_PX));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box]);
  return narrow;
}
