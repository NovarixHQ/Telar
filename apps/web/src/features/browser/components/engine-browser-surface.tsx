"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { GlobeIcon } from "lucide-react";
import type { BrowserInput } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { Spinner } from "@/ui/spinner";
import { EngineBrowserChrome } from "./engine-browser-chrome";
import { addressToUrl, keyInput, mouseInput, pagePoint } from "../engine-browser-input";
import { useEngineBrowser } from "../hooks/use-engine-browser";

const RESIZE_DEBOUNCE_MS = 200;
const MOVE_THROTTLE_MS = 30;

/** The engine's own Chromium, drawn from its screencast. Everything typed or clicked here goes to that page. */
export function EngineBrowserSurface({ sessionId, hostId = LOCAL_HOST_ID }: { sessionId: string; hostId?: string }) {
  const { frame, tabs, error } = useEngineBrowser(hostId, sessionId);
  const api = useMemo(() => createEngineApi(hostFetcher(hostId)), [hostId]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastMove = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [address, setAddress] = useState<string>();
  const active = tabs.find((tab) => tab.active);
  const width = frame?.width;
  const height = frame?.height;

  const send = useCallback(
    (input: BrowserInput) => {
      queue.current = queue.current.then(() => api.browserInput(sessionId, input)).catch(() => undefined);
    },
    [api, sessionId],
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { width, height } = element.getBoundingClientRect();
        if (width >= 100 && height >= 100) send({ type: "resize", width: Math.round(width), height: Math.round(height) });
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [send]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const drawn = image.current?.getBoundingClientRect();
      if (!drawn || !width || !height) return;
      event.preventDefault();
      send({ type: "wheel", ...pagePoint(event, drawn, { width, height }), deltaX: event.deltaX, deltaY: event.deltaY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [send, width, height]);

  const point = (event: PointerEvent) => {
    const drawn = image.current?.getBoundingClientRect();
    return drawn && frame ? pagePoint(event, drawn, frame) : null;
  };
  const pointer = (action: "move" | "down" | "up", event: PointerEvent) => {
    const at = point(event);
    if (!at) return;
    if (action === "move") {
      if (event.timeStamp - lastMove.current < MOVE_THROTTLE_MS) return;
      lastMove.current = event.timeStamp;
    }
    if (action === "down") (event.currentTarget as HTMLElement).focus();
    send(mouseInput(action, event, at));
  };
  const key = (action: "down" | "up", event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(keyInput(action, { key: event.key, code: event.code, keyCode: event.keyCode, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }));
  };

  const go = (event: FormEvent) => {
    event.preventDefault();
    const url = addressToUrl(address ?? "");
    if (url) send({ type: "navigate", url });
    setAddress(undefined);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <GlobeIcon className="mx-auto size-8 text-muted-foreground/40" />
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EngineBrowserChrome tabs={tabs} address={address ?? active?.url ?? ""} onAddress={setAddress} onSubmit={go} send={send} />
      <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden bg-muted/40">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element -- a screencast frame as a data URL; there is nothing for next/image to optimise
          <img
            ref={image}
            src={frame.src}
            alt={`Live view of ${active?.title || active?.url || "the browser"}`}
            tabIndex={0}
            draggable={false}
            onPointerDown={(event) => pointer("down", event)}
            onPointerUp={(event) => pointer("up", event)}
            onPointerMove={(event) => pointer("move", event)}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => key("down", event)}
            onKeyUp={(event) => key("up", event)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (text) send({ type: "text", text });
            }}
            className="block size-full object-contain outline-none"
          />
        ) : (
          <div className="grid h-full place-items-center">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
