"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquareTextIcon } from "lucide-react";
import { useCommandHandlers } from "@/features/commands";
import type { ComposerProps } from "@/features/composer";
import { usePanelFullscreen } from "@/features/panel";
import { trackOverlayElement, useOverlayLayer } from "@/platform/desktop/overlay-layer";
import { MiniSurface, NOTCH } from "./mini-surface";

const EDGE_PX = 48;
const LINGER_MS = 400;

type PageEdge = { onNearBottom?: (listener: (report: { near: boolean }) => void) => () => void };

function pageEdge(): PageEdge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { telarDesktop?: { browser?: PageEdge } }).telarDesktop?.browser;
}

function usePointerNearBottom(active: boolean): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!active) return;
    let overCockpit = false;
    let overPage = false;
    const update = () => setNear(overCockpit || overPage);
    const onMove = (event: MouseEvent) => {
      const next = window.innerHeight - event.clientY <= EDGE_PX;
      if (next === overCockpit) return;
      overCockpit = next;
      update();
    };
    const onLeave = () => {
      overCockpit = false;
      update();
    };
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    const stop = pageEdge()?.onNearBottom?.((report) => {
      overPage = report.near;
      update();
    });
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      stop?.();
      setNear(false);
    };
  }, [active]);
  return near;
}

function useLinger(on: boolean): boolean {
  const [lingering, setLingering] = useState(false);
  const [was, setWas] = useState(on);
  if (was !== on) {
    setWas(on);
    if (!on) setLingering(true);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [lingering]);
  return on || lingering;
}

function Notch({ onOpen }: { onOpen: () => void }) {
  const layer = useOverlayLayer();
  const notch = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const shown = useLinger(usePointerNearBottom(true) || hovered);
  useEffect(() => {
    const element = notch.current;
    if (shown && layer && element) return trackOverlayElement(element);
  }, [shown, layer]);
  if (!shown) return null;
  return createPortal(
    <button
      ref={notch}
      type="button"
      aria-label="Write a message"
      title="Write a message"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={onOpen}
      style={{ width: NOTCH.width, height: NOTCH.height, bottom: NOTCH.bottom, left: `calc(50% - ${NOTCH.width / 2}px)` }}
      className="fixed z-50 flex items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow-2 ring-1 ring-foreground/10 backdrop-blur-xl transition-colors hover:text-foreground"
    >
      <MessageSquareTextIcon className="size-3.5" />
    </button>,
    layer ?? document.body,
  );
}

type Opened = "type" | "dictate";

export function MiniComposer({ composer, exchange }: { composer: ComposerProps; exchange: ReactNode }) {
  const fullscreen = usePanelFullscreen();
  const [opened, setOpened] = useState<Opened>();
  if (opened && !fullscreen) setOpened(undefined);
  const closed = !opened;
  useCommandHandlers(fullscreen && closed ? { "toggle-dictation": () => setOpened("dictate"), "mini-composer": () => setOpened("type") } : {}, [fullscreen, closed]);
  const onClosed = useCallback(() => setOpened(undefined), []);
  if (!fullscreen) return null;
  if (!opened) return <Notch onOpen={() => setOpened("type")} />;
  return <MiniSurface composer={composer} exchange={exchange} dictate={opened === "dictate"} onClosed={onClosed} />;
}
