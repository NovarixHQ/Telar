import { useLayoutEffect, useState, type RefObject } from "react";

const NARROW_COMPOSER_PX = 448;
const WIDE_AGAIN_PX = NARROW_COMPOSER_PX + 16;
const EDITOR = '[data-slot="composer-editor"]';

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

function wraps(editor: HTMLElement): boolean {
  const style = getComputedStyle(editor);
  const line = Number.parseFloat(style.lineHeight) || 24;
  const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  return editor.scrollHeight - padding >= 2 * line;
}

export function useInlineWhileOneLine(box: RefObject<HTMLElement | null>, draft: string, narrow: boolean): boolean {
  const [wrappedAt, setWrappedAt] = useState<number>();
  const inline = narrow && !draft.includes("\n") && (wrappedAt === undefined || draft.length < wrappedAt);
  useLayoutEffect(() => {
    const editor = box.current?.querySelector<HTMLElement>(EDITOR);
    if (!inline || !editor || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (wraps(editor)) setWrappedAt(draft.length);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [box, inline, draft]);
  return inline;
}
