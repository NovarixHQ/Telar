import type { CSSProperties, ReactNode } from "react";
import type { SimulatorSummary } from "@telar/engine-client";

type Edge = "left" | "right" | "top";
type Button = { edge: Edge; at: number; length: number; depth: number };
export type DeviceShape = { kind: "phone" | "tablet" | "watch"; aspect: number; bezel: number; screenRadius: number; buttons: Button[] };
type Box = { width: number; height: number };
type Rect = { left: number; top: number; width: number; height: number };

const PHONE: DeviceShape = {
  kind: "phone",
  aspect: 9 / 19.5,
  bezel: 0.045,
  screenRadius: 0.14,
  buttons: [
    { edge: "left", at: 0.17, length: 0.05, depth: 0.012 },
    { edge: "left", at: 0.25, length: 0.09, depth: 0.012 },
    { edge: "left", at: 0.36, length: 0.09, depth: 0.012 },
    { edge: "right", at: 0.28, length: 0.14, depth: 0.012 },
  ],
};
const TABLET: DeviceShape = {
  kind: "tablet",
  aspect: 3 / 4,
  bezel: 0.05,
  screenRadius: 0.035,
  buttons: [
    { edge: "top", at: 0.82, length: 0.08, depth: 0.008 },
    { edge: "right", at: 0.1, length: 0.06, depth: 0.008 },
    { edge: "right", at: 0.18, length: 0.06, depth: 0.008 },
  ],
};
const WATCH: DeviceShape = {
  kind: "watch",
  aspect: 0.84,
  bezel: 0.09,
  screenRadius: 0.2,
  buttons: [
    { edge: "right", at: 0.22, length: 0.17, depth: 0.06 },
    { edge: "right", at: 0.5, length: 0.24, depth: 0.025 },
  ],
};

export function deviceShape(simulator: Pick<SimulatorSummary, "name" | "version">): DeviceShape {
  if (/watchOS/i.test(simulator.version) || /\bwatch\b/i.test(simulator.name)) return WATCH;
  return /\bipad\b/i.test(simulator.name) ? TABLET : PHONE;
}

const depthOf = (shape: DeviceShape) => Math.max(...shape.buttons.map((button) => button.depth));

export function fitDevice(shape: DeviceShape, aspect: number, room: Box): Box & { unit: number } {
  if (room.width <= 0 || room.height <= 0 || aspect <= 0) return { width: 0, height: 0, unit: 0 };
  const across = aspect >= 1 ? aspect : 1;
  const down = aspect >= 1 ? 1 : 1 / aspect;
  const margin = 2 * (shape.bezel + depthOf(shape));
  const unit = Math.min(room.width / (across + margin), room.height / (down + margin));
  return { width: across * unit, height: down * unit, unit };
}

function turn(rect: Rect, box: Box, degrees: number): Rect {
  const { left, top, width, height } = rect;
  if (degrees === 90) return { left: box.height - top - height, top: left, width: height, height: width };
  if (degrees === -90) return { left: top, top: box.width - left - width, width: height, height: width };
  if (degrees === 180) return { left: box.width - left - width, top: box.height - top - height, width, height };
  return rect;
}

function buttonRect(button: Button, body: Box, unit: number): Rect {
  const depth = Math.max(2, button.depth * unit);
  if (button.edge === "top") return { left: button.at * body.width, top: -depth, width: button.length * body.width, height: depth };
  return { left: button.edge === "left" ? -depth : body.width, top: button.at * body.height, width: depth, height: button.length * body.height };
}

type FrameProps = { shape: DeviceShape; screen: Box; unit: number; degrees: number; children: ReactNode };

export function DeviceFrame({ shape, screen, unit, degrees, children }: FrameProps) {
  const bezel = shape.bezel * unit;
  const sideways = Math.abs(degrees) === 90;
  const body = { width: screen.width + 2 * bezel, height: screen.height + 2 * bezel };
  const upright = (box: Box) => (sideways ? { width: box.height, height: box.width } : box);
  const island = shape.kind === "phone" && shape.aspect < 0.5;
  const uprightScreen = upright(screen);
  const islandRect = { left: uprightScreen.width * 0.345, top: uprightScreen.width * 0.028, width: uprightScreen.width * 0.31, height: uprightScreen.width * 0.092 };
  const radius = (fraction: number): CSSProperties => ({ borderRadius: fraction * unit });
  return (
    <div data-testid="device-frame" className="relative shrink-0 bg-foreground shadow-lg ring-1 ring-muted-foreground/40" style={{ ...body, padding: bezel, ...radius(shape.screenRadius + shape.bezel) }}>
      {shape.buttons.map((button) => (
        <span key={`${button.edge}${button.at}`} aria-hidden className="absolute rounded-full bg-muted-foreground" style={turn(buttonRect(button, upright(body), unit), upright(body), degrees)} />
      ))}
      <div className="relative size-full overflow-hidden bg-foreground" style={radius(shape.screenRadius)}>
        {children}
        {island && <span aria-hidden className="pointer-events-none absolute rounded-full bg-foreground" style={turn(islandRect, uprightScreen, degrees)} />}
      </div>
    </div>
  );
}
