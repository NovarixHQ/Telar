"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { runCommand, useCommandHandlers } from "@/features/commands";
import { Composer, type ComposerProps } from "@/features/composer";
import { usePanelFullscreen } from "@/features/panel";
import { trackOverlayElement, useOverlayLayer } from "@/platform/desktop/overlay-layer";

type Phase = Parameters<NonNullable<ComposerProps["onDictationPhase"]>>[0];

export function MiniComposer(props: ComposerProps) {
  const fullscreen = usePanelFullscreen();
  const [open, setOpen] = useState(false);
  if (open && !fullscreen) setOpen(false);
  useCommandHandlers(fullscreen && !open ? { "toggle-dictation": () => setOpen(true) } : {}, [fullscreen, open]);
  const close = useCallback(() => setOpen(false), []);
  return open && fullscreen ? <FloatingComposer {...props} onClose={close} /> : null;
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

function FloatingComposer({ onClose, ...props }: ComposerProps & { onClose: () => void }) {
  const layer = useOverlayLayer();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (layer && element) return trackOverlayElement(element);
  }, [layer]);
  useEffect(() => {
    runCommand("focus-composer");
  }, []);
  const onDictationPhase = useClosesWhenNothingWasHeard(props.draft, onClose);
  const { onSubmit, busy } = props;
  const submit = useCallback(() => {
    onSubmit();
    onClose();
  }, [onSubmit, onClose]);
  const escape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || busy) return;
    event.preventDefault();
    onClose();
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-4">
      <div ref={box} role="dialog" aria-label="Message" onKeyDown={escape} className="pointer-events-auto w-full max-w-(--chat-content-max-width)">
        <Composer {...props} compact readingBack dictateOnOpen onSubmit={submit} onDictationPhase={onDictationPhase} />
      </div>
    </div>,
    layer ?? document.body,
  );
}
