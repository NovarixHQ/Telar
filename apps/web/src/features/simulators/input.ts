import { MAX_CROWN_DELTA, type SimulatorInput } from "@telar/engine-client";

export type Orientation = "portrait" | "landscape_left" | "portrait_upside_down" | "landscape_right";
export type ScreenConfig = { width: number; height: number; orientation: Orientation };

const HID_BY_CODE: Record<string, number> = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
  BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34,
  Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38, Delete: 0x4c,
  ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
  ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3,
  ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
};

export function hidUsage(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return 0x04 + (code.charCodeAt(3) - 65);
  if (/^Digit[1-9]$/.test(code)) return 0x1e + (code.charCodeAt(5) - 49);
  if (code === "Digit0") return 0x27;
  return HID_BY_CODE[code];
}

export const NEXT_ORIENTATION: Record<Orientation, Orientation> = {
  portrait: "landscape_left",
  landscape_left: "portrait_upside_down",
  portrait_upside_down: "landscape_right",
  landscape_right: "portrait",
};

export const ROTATION_DEGREES: Record<Orientation, number> = { portrait: 0, landscape_left: 90, portrait_upside_down: 180, landscape_right: -90 };

export function rawPoint(x: number, y: number, screen: ScreenConfig | undefined): { x: number; y: number } {
  if (!screen || screen.width > screen.height) return { x, y };
  switch (screen.orientation) {
    case "landscape_left":
      return { x: y, y: 1 - x };
    case "landscape_right":
      return { x: 1 - y, y: x };
    case "portrait_upside_down":
      return { x: 1 - x, y: 1 - y };
    default:
      return { x, y };
  }
}

export function readScreenConfig(value: unknown): ScreenConfig | undefined {
  const config = value as Partial<ScreenConfig> | null;
  if (!config || typeof config.width !== "number" || typeof config.height !== "number") return undefined;
  const orientation = config.orientation && config.orientation in NEXT_ORIENTATION ? config.orientation : "portrait";
  return { width: config.width, height: config.height, orientation };
}

const WHEEL_LINE_PX = 16;
const clampCrown = (delta: number) => Math.min(MAX_CROWN_DELTA, Math.max(-MAX_CROWN_DELTA, delta));

export function crownDelta(deltaY: number, deltaMode: number, pageHeight: number): number | undefined {
  const pixels = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * pageHeight : deltaY;
  const delta = clampCrown(pixels);
  return Number.isFinite(delta) && delta !== 0 ? delta : undefined;
}

export function inputQueue(send: (events: SimulatorInput[]) => Promise<unknown>, onError: (error: unknown) => void) {
  let pending: SimulatorInput[] = [];
  let busy = false;
  const flush = async () => {
    if (busy || pending.length === 0) return;
    busy = true;
    const batch = pending;
    pending = [];
    try {
      await send(batch);
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
      void flush();
    }
  };
  return (event: SimulatorInput) => {
    const last = pending.at(-1);
    if (event.type === "touch" && event.phase === "move" && last?.type === "touch" && last.phase === "move") pending[pending.length - 1] = event;
    else if (event.type === "crown" && last?.type === "crown") pending[pending.length - 1] = { type: "crown", delta: clampCrown(last.delta + event.delta) };
    else pending.push(event);
    void flush();
  };
}
