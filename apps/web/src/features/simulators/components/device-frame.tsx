import type { CSSProperties, ReactNode } from "react";
import type { SimulatorChrome, SimulatorSummary } from "@telar/engine-client";

type Box = { width: number; height: number };
type Rect = Box & { x: number; y: number };
type Frame = NonNullable<SimulatorChrome["frame"]>;
type Art = { src: string } & Box;

export type Device = { body: Box; screen: Rect; radius: number; bounds: Rect; frame: Frame | null };

const BEZEL = 0.045;
const PLAIN_RADIUS = { phone: 0.14, tablet: 0.035, watch: 0.2 };
const NO_STREAM: Box = { width: 9, height: 19.5 };

export function isWatch(simulator: Pick<SimulatorSummary, "name" | "version">): boolean {
  return /watchOS/i.test(simulator.version) || /\bwatch\b/i.test(simulator.name);
}

function plainRadius(simulator: Pick<SimulatorSummary, "name" | "version">, width: number): number {
  if (isWatch(simulator)) return PLAIN_RADIUS.watch * width;
  return (/\bipad\b/i.test(simulator.name) ? PLAIN_RADIUS.tablet : PLAIN_RADIUS.phone) * width;
}

export function uprightDevice(chrome: SimulatorChrome | null | undefined, stream: Box | undefined, simulator: Pick<SimulatorSummary, "name" | "version">): Device {
  const frame = chrome?.frame;
  if (chrome && frame) {
    const xs = [0, frame.width, ...frame.buttons.flatMap((button) => [button.x, button.x + button.width])];
    const ys = [0, frame.height, ...frame.buttons.flatMap((button) => [button.y, button.y + button.height])];
    const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    return { body: { width: frame.width, height: frame.height }, screen: { ...frame.screen, width: chrome.screen.width, height: chrome.screen.height }, radius: chrome.screen.cornerRadius, bounds, frame };
  }
  const size = chrome?.screen ?? (stream ? { width: Math.min(stream.width, stream.height), height: Math.max(stream.width, stream.height) } : NO_STREAM);
  const bezel = BEZEL * Math.min(size.width, size.height);
  const body = { width: size.width + 2 * bezel, height: size.height + 2 * bezel };
  const radius = chrome?.screen.cornerRadius || plainRadius(simulator, size.width);
  return { body, screen: { x: bezel, y: bezel, width: size.width, height: size.height }, radius, bounds: { x: 0, y: 0, ...body }, frame: null };
}

export function fitDevice(device: Device, degrees: number, room: Box): number {
  const sideways = Math.abs(degrees) === 90;
  const width = sideways ? device.bounds.height : device.bounds.width;
  const height = sideways ? device.bounds.width : device.bounds.height;
  if (room.width <= 0 || room.height <= 0) return 0;
  return Math.min(room.width / width, room.height / height);
}

const picture = (art: Art): CSSProperties => ({ backgroundImage: `url("${art.src}")`, backgroundSize: "100% 100%" });

function Slices({ slices, scale }: { slices: Frame["slices"]; scale: number }) {
  const cells = [slices.topLeft, slices.top, slices.topRight, slices.left, undefined, slices.right, slices.bottomLeft, slices.bottom, slices.bottomRight];
  const track = (start: number, end: number) => `${start * scale}px minmax(0, 1fr) ${end * scale}px`;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 grid"
      style={{ gridTemplateColumns: track(slices.topLeft.width, slices.topRight.width), gridTemplateRows: track(slices.topLeft.height, slices.bottomLeft.height) }}
    >
      {cells.map((art, index) => (
        <span key={index} style={art ? picture(art) : undefined} />
      ))}
    </div>
  );
}

type FrameProps = { device: Device; scale: number; degrees: number; children: ReactNode };

export function DeviceFrame({ device, scale, degrees, children }: FrameProps) {
  const { bounds, body, screen, frame } = device;
  const px = (points: number) => points * scale;
  const sideways = Math.abs(degrees) === 90;
  const outer = { width: px(sideways ? bounds.height : bounds.width), height: px(sideways ? bounds.width : bounds.height) };
  const at = (rect: Rect): CSSProperties => ({ left: px(rect.x - bounds.x), top: px(rect.y - bounds.y), width: px(rect.width), height: px(rect.height) });
  const buttons = (onTop: boolean) =>
    frame?.buttons.filter((button) => button.onTop === onTop).map((button, index) => <span key={index} aria-hidden className="pointer-events-none absolute" style={{ ...at(button), ...picture(button) }} />);
  return (
    <div data-testid="device-frame" className="relative shrink-0" style={outer}>
      <div
        className="absolute"
        style={{ width: px(bounds.width), height: px(bounds.height), left: (outer.width - px(bounds.width)) / 2, top: (outer.height - px(bounds.height)) / 2, ...(degrees ? { transform: `rotate(${degrees}deg)` } : {}) }}
      >
        {buttons(false)}
        <div className="absolute" style={at({ x: 0, y: 0, ...body })}>
          {frame ? <Slices slices={frame.slices} scale={scale} /> : <div className="absolute inset-0 bg-foreground shadow-lg ring-1 ring-muted-foreground/40" style={{ borderRadius: px(device.radius + screen.x) }} />}
        </div>
        <div className="absolute overflow-hidden bg-black" style={{ ...at(screen), borderRadius: px(device.radius) }}>
          {children}
        </div>
        {buttons(true)}
      </div>
    </div>
  );
}
