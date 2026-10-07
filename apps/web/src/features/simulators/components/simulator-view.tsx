"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { SimulatorChrome, SimulatorInput, SimulatorSummary } from "@telar/engine-client";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/ui/utils";
import { hubUrl, type SimulatorsApi } from "../api";
import { useBox } from "../hooks/use-box";
import { DeviceFrame, fitDevice, isWatch, uprightDevice, type Device } from "./device-frame";
import { FloatPill, SimulatorToolbar } from "./simulator-toolbar";
import { crownDelta, hidUsage, inputQueue, NEXT_ORIENTATION, rawPoint, readScreenConfig, ROTATION_DEGREES, type Orientation, type ScreenConfig } from "../input";
import { startStream, type StreamStatus } from "../stream";

const TICKET_REFRESH_MS = 4 * 60_000;
const CONFIG_POLL_MS = 2_000;
const STAGE_PADDING = 24;
const COPIED_MS = 1_500;

type Docked = { settingsOpen: boolean; onToggleSettings: () => void; onPowerOff: () => Promise<void>; onFloat?: () => void };
type Floating = { onDock: () => void; onClose: () => void; onAspect: (aspect: number) => void };

type ViewProps = {
  simulator: SimulatorSummary;
  api: SimulatorsApi;
  hostId?: string;
  visible: boolean;
} & ({ docked: Docked; floating?: never } | { floating: Floating; docked?: never });

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

function useTicket(api: SimulatorsApi, visible: boolean): (() => string) | undefined {
  const latest = useRef("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keep = (ticket: string, expiresAt = 0) => {
      if (cancelled) return;
      latest.current = ticket;
      setReady(true);
      const left = expiresAt - Date.now();
      timer = setTimeout(mint, left > 0 ? Math.min(left / 2, TICKET_REFRESH_MS) : TICKET_REFRESH_MS);
    };
    const mint = () =>
      void api
        .simulatorStreamTicket()
        .then((answer) => keep(answer.ticket, answer.expiresAt))
        .catch(() => keep(""));
    mint();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, visible]);
  return useMemo(() => (ready ? () => latest.current : undefined), [ready]);
}

function useScreenConfig(url: (() => string) | undefined): ScreenConfig | undefined {
  const [screen, setScreen] = useState<ScreenConfig>();
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const read = () =>
      void fetch(url())
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value) => {
          const config = readScreenConfig(value);
          if (!cancelled && config) setScreen(config);
        })
        .catch(() => undefined);
    read();
    const timer = setInterval(read, CONFIG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url]);
  return screen;
}

function useChrome(api: SimulatorsApi, id: string, wanted: boolean): SimulatorChrome | null | undefined {
  const [chrome, setChrome] = useState<{ id: string; value: SimulatorChrome | null }>();
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void api
      .simulatorChrome(id)
      .then((answer) => answer.chrome)
      .catch(() => null)
      .then((value) => !cancelled && setChrome({ id, value }));
    return () => {
      cancelled = true;
    };
  }, [api, id, wanted]);
  return chrome?.id === id ? chrome.value : undefined;
}

function useMjpegProbe(image: HTMLImageElement | null, url: string | undefined, loaded: (width: number, height: number) => void) {
  useEffect(() => {
    if (!image || !url) return;
    const timer = setInterval(() => {
      if (image.naturalWidth <= 0) return;
      loaded(image.naturalWidth, image.naturalHeight);
      clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [image, url, loaded]);
}

function useScreenshotCopy(api: SimulatorsApi, id: string, onError: (message: string | undefined) => void) {
  const [capture, setCapture] = useState<"idle" | "copying" | "copied">("idle");
  useEffect(() => {
    if (capture !== "copied") return;
    const timer = setTimeout(() => setCapture("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [capture]);
  const screenshot = async () => {
    onError(undefined);
    setCapture("copying");
    try {
      const { data, contentType } = await api.simulatorScreenshot(id);
      await navigator.clipboard.write([new ClipboardItem({ [contentType]: new Blob([data as BlobPart], { type: contentType }) })]);
      setCapture("copied");
    } catch {
      setCapture("idle");
      onError("The screenshot could not be copied.");
    }
  };
  return { capture, screenshot };
}

function StreamOverlay({ status, onReconnect }: { status: StreamStatus; onReconnect: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 text-xs text-muted-foreground">
      {status.state === "error" ? (
        <>
          <p>{status.detail ?? "The simulator's video stopped."}</p>
          <Button size="xs" variant="outline" onClick={onReconnect}>
            Reconnect
          </Button>
        </>
      ) : (
        <>
          <Spinner />
          <p>Connecting to the simulator…</p>
        </>
      )}
    </div>
  );
}

function useRotate(screen: ScreenConfig | undefined, press: (event: SimulatorInput) => void) {
  const [rotation, setRotation] = useState<{ from?: Orientation; sent: Orientation }>();
  return () => {
    const current = rotation && rotation.from === screen?.orientation ? rotation.sent : screen?.orientation;
    const next = NEXT_ORIENTATION[current ?? "portrait"];
    setRotation({ ...(screen ? { from: screen.orientation } : {}), sent: next });
    press({ type: "orientation", orientation: next });
  };
}

function deviceLayout(device: Device, screen: ScreenConfig | undefined, room: { width: number; height: number }) {
  const turnedBy = screen ? ROTATION_DEGREES[screen.orientation] : 0;
  const sideways = Math.abs(turnedBy) === 90;
  const scale = fitDevice(device, turnedBy, room);
  const shown = { width: device.screen.width * scale, height: device.screen.height * scale };
  const degrees = screen && screen.width > screen.height ? -turnedBy : 0;
  const media: CSSProperties =
    Math.abs(degrees) === 90
      ? { width: shown.height, height: shown.width, left: (shown.width - shown.height) / 2, top: (shown.height - shown.width) / 2, transform: `rotate(${degrees}deg)` }
      : { ...shown, ...(degrees ? { transform: `rotate(${degrees}deg)` } : {}) };
  const aspect = sideways ? device.bounds.height / device.bounds.width : device.bounds.width / device.bounds.height;
  return { turnedBy, scale, shown, media, aspect };
}

function useTouch(screen: ScreenConfig | undefined, press: (event: SimulatorInput) => void, focus: () => void) {
  const pointing = useRef(false);
  const touch = (phase: "begin" | "move" | "end", event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = rawPoint(clamp01((event.clientX - rect.left) / rect.width), clamp01((event.clientY - rect.top) / rect.height), screen);
    press({ type: "touch", phase, ...point });
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointing.current) return;
    pointing.current = false;
    touch("end", event);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      focus();
      pointing.current = true;
      touch("begin", event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (pointing.current) touch("move", event);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

export function SimulatorView({ simulator, api, hostId, visible, docked, floating }: ViewProps) {
  const ios = simulator.platform === "ios";
  const ticket = useTicket(api, visible && ios);
  const url = useMemo(
    () => ticket && ((file: string) => hubUrl(`/vendor/serve-sim/helper/${encodeURIComponent(simulator.id)}/${file}`, { hostId, ticket: ticket() })),
    [hostId, simulator.id, ticket],
  );
  const config = useMemo(() => (visible && url ? () => url("config") : undefined), [visible, url]);
  const screen = useScreenConfig(config);
  const [status, setStatus] = useState<StreamStatus>({ state: "connecting" });
  const [mjpeg, setMjpeg] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [inputError, setInputError] = useState<string>();
  const [powering, setPowering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<ReturnType<typeof startStream>>(undefined);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const box = useBox(host);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useMjpegProbe(image, mjpeg, useCallback((width: number, height: number) => stream.current?.mjpegLoaded(width, height), []));

  useEffect(() => {
    if (!visible || !url || !canvas.current) return;
    setMjpeg(undefined);
    const started = startStream({ canvas: canvas.current, url, onStatus: setStatus, onMjpeg: setMjpeg, onFrame: () => undefined });
    stream.current = started;
    return () => started.stop();
  }, [visible, url, attempt]);

  const send = useMemo(
    () => inputQueue((events) => api.sendSimulatorInput(simulator.id, events), (error) => setInputError(error instanceof Error ? error.message : "Input did not reach the simulator.")),
    [api, simulator.id],
  );
  const press = (event: SimulatorInput) => {
    setInputError(undefined);
    send(event);
  };
  const rotate = useRotate(screen, press);
  const pointer = useTouch(screen, press, () => host?.focus());

  const chrome = useChrome(api, simulator.id, visible && ios);
  const watch = isWatch(simulator);
  const padding = floating ? 0 : STAGE_PADDING;
  const device = uprightDevice(chrome, screen, simulator);
  const { turnedBy, scale, shown, media, aspect } = deviceLayout(device, screen, { width: box.width - 2 * padding, height: box.height - 2 * padding });
  const onAspect = floating?.onAspect;
  useEffect(() => onAspect?.(aspect), [onAspect, aspect]);

  const powerOff = async () => {
    setPowering(true);
    await docked?.onPowerOff().finally(() => setPowering(false));
  };
  const { capture, screenshot } = useScreenshotCopy(api, simulator.id, setInputError);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {inputError && <p role="alert" className={cn("px-3 py-1.5 text-2xs text-destructive", floating ? "absolute inset-x-0 bottom-0 z-10 rounded-b-xl bg-popover" : "border-b border-border")}>{inputError}</p>}
      <div className="flex min-h-0 flex-1">
        {!ios ? (
          <p className="min-w-0 flex-1 px-4 py-6 text-center text-xs text-muted-foreground">Emulators can be started, stopped and set up here, but not shown yet.</p>
        ) : (
          <div
            ref={setHost}
            tabIndex={0}
            role="application"
            aria-label={`${simulator.name} screen`}
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center outline-none"
            onKeyDown={(event) => {
              const usage = hidUsage(event.code);
              if (usage === undefined || event.target !== event.currentTarget || (event.metaKey && event.key.toLowerCase() !== "r") || (floating && event.code === "Escape")) return;
              event.preventDefault();
              press({ type: "key", phase: "down", usage });
            }}
            onKeyUp={(event) => {
              const usage = hidUsage(event.code);
              if (usage !== undefined && event.target === event.currentTarget) press({ type: "key", phase: "up", usage });
            }}
          >
            <DeviceFrame device={device} scale={scale} degrees={turnedBy}>
              <div
                data-testid="simulator-frame"
                className="relative touch-none select-none"
                style={shown}
                {...pointer}
                onWheel={(event) => {
                  const delta = watch ? crownDelta(event.deltaY, event.deltaMode, shown.height) : undefined;
                  if (delta !== undefined) press({ type: "crown", delta });
                }}
              >
                <canvas ref={canvas} className={cn("absolute top-0 left-0", mjpeg && "hidden")} style={media} />
                {mjpeg && (
                  <img
                    ref={setImage}
                    alt=""
                    src={mjpeg}
                    className="absolute top-0 left-0 object-contain"
                    style={media}
                    onError={() => setStatus({ state: "error", detail: "The simulator's video stopped." })}
                  />
                )}
              </div>
            </DeviceFrame>
            {watch && !floating && <p className="pointer-events-none absolute inset-x-0 bottom-2 px-4 text-center text-2xs text-muted-foreground">{"Touch doesn't reach watch simulators; scroll over the screen to turn the Digital Crown."}</p>}
            {status.state !== "streaming" && <StreamOverlay status={status} onReconnect={() => setAttempt((count) => count + 1)} />}
            {floating && <FloatPill phone={!watch} onHome={() => press({ type: "button", button: "home" })} onRotate={rotate} onDock={floating.onDock} onClose={floating.onClose} />}
          </div>
        )}
        {docked && (
          <SimulatorToolbar
            phone={ios && !watch}
            powering={powering}
            capture={capture}
            settingsOpen={docked.settingsOpen}
            onHome={() => press({ type: "button", button: "home" })}
            onRotate={rotate}
            {...(ios ? { onScreenshot: () => void screenshot() } : {})}
            {...(watch ? { onCrown: () => press({ type: "button", button: "digital_crown" }), onSide: () => press({ type: "button", button: "side_button" }) } : {})}
            {...(ios && docked.onFloat ? { onFloat: docked.onFloat } : {})}
            onToggleSettings={docked.onToggleSettings}
            onPowerOff={() => void powerOff()}
          />
        )}
      </div>
    </div>
  );
}
