"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { runCommand } from "@/features/commands";
import { Composer, type ComposerProps } from "@/features/composer";
import { afterOverlayShows, trackOverlayElement, useOverlayLayer } from "@/platform/desktop/overlay-layer";

type Phase = Parameters<NonNullable<ComposerProps["onDictationPhase"]>>[0];

export const NOTCH = { width: 64, height: 22, bottom: 8 };
const MORPH_MS = 220;
const EASE_OUT = "cubic-bezier(.22,1,.36,1)";

function reducedMotion(view: Window | null): boolean {
  return Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function notchClip(card: DOMRect, view: Window): string {
  const left = view.innerWidth / 2 - NOTCH.width / 2;
  const top = view.innerHeight - NOTCH.bottom - NOTCH.height;
  const inset = [top - card.top, card.right - (left + NOTCH.width), card.bottom - (top + NOTCH.height), left - card.left];
  return `inset(${inset.map((px) => `${Math.round(px)}px`).join(" ")} round ${NOTCH.height / 2}px)`;
}

function morph(card: HTMLElement, backdrop: HTMLElement, opening: boolean): Promise<void> {
  const view = card.ownerDocument.defaultView;
  if (!view || reducedMotion(view) || typeof card.animate !== "function") return Promise.resolve();
  const from = { clipPath: notchClip(card.getBoundingClientRect(), view), opacity: 0.6 };
  const to = { clipPath: "inset(0px round 16px)", opacity: 1 };
  const frames = opening ? [from, to] : [to, from];
  const fades = opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  const timing = { duration: MORPH_MS, easing: EASE_OUT, fill: "both" as const };
  backdrop.animate(fades, timing);
  card.animate(frames, timing);
  return new Promise((resolve) => setTimeout(resolve, MORPH_MS));
}

function useClosesWhenNothingWasHeard(draft: string, onClose: () => void) {
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });
  const startedFrom = useRef<string | null>(null);
  const [ended, setEnded] = useState<{ from: string }>();
  const judged = useRef<{ from: string }>(undefined);
  useEffect(() => {
    if (!ended || judged.current === ended) return;
    judged.current = ended;
    if (draft.trim() === ended.from.trim()) onClose();
  }, [ended, draft, onClose]);
  return useCallback((phase: Phase) => {
    if (phase === "listening") startedFrom.current = latest.current;
    if (phase !== "idle" || startedFrom.current === null) return;
    setEnded({ from: startedFrom.current });
    startedFrom.current = null;
  }, []);
}

function useMorph(onClosed: () => void) {
  const card = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  useLayoutEffect(() => {
    const element = card.current;
    const shade = backdrop.current;
    if (!element || !shade) return;
    element.style.visibility = "hidden";
    return afterOverlayShows(() => {
      element.style.visibility = "";
      void morph(element, shade, true);
    });
  }, []);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const element = card.current;
    const shade = backdrop.current;
    void (element && shade ? morph(element, shade, false) : Promise.resolve()).then(onClosed);
  }, [onClosed]);
  return { card, backdrop, close };
}

export function MiniSurface({ composer, exchange, dictate, onClosed }: { composer: ComposerProps; exchange: ReactNode; dictate: boolean; onClosed: () => void }) {
  const layer = useOverlayLayer();
  const box = useRef<HTMLDivElement>(null);
  const { card, backdrop, close } = useMorph(onClosed);
  useEffect(() => {
    const element = box.current;
    if (layer && element) return trackOverlayElement(element);
  }, [layer]);
  useEffect(() => {
    runCommand("focus-composer");
  }, []);
  const onDictationPhase = useClosesWhenNothingWasHeard(composer.draft, close);
  const { onSubmit, busy } = composer;
  const submit = useCallback(() => {
    onSubmit();
    close();
  }, [onSubmit, close]);
  const escape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || busy) return;
    event.preventDefault();
    close();
  };

  return createPortal(
    <div ref={box} className="fixed inset-0 z-50 flex flex-col items-center justify-end pb-4">
      <div ref={backdrop} data-slot="mini-backdrop" aria-hidden className="absolute inset-0 bg-overlay supports-backdrop-filter:backdrop-blur-xs" onMouseDown={close} />
      <div ref={card} role="dialog" aria-label="Message" onKeyDown={escape} className="relative flex w-full max-w-(--chat-content-max-width) flex-col gap-2 px-4">
        {exchange ? (
          <div data-slot="mini-exchange" className="max-h-[40vh] overflow-y-auto rounded-2xl bg-card/95 p-3 text-xs shadow-2 ring-1 ring-foreground/10 backdrop-blur-xl">
            {exchange}
          </div>
        ) : null}
        <Composer {...composer} compact readingBack dictateOnOpen={dictate} onSubmit={submit} {...(dictate ? { onDictationPhase } : {})} />
      </div>
    </div>,
    layer ?? document.body,
  );
}
