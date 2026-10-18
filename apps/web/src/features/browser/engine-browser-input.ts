import type { BrowserInput } from "@telar/engine-client";

type Modifiers = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

const modifiersOf = (event: Modifiers): number => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

const BUTTONS = ["left", "middle", "right"] as const;
const TEXT_KEYS: Record<string, string> = { Enter: "\r", Tab: "\t" };

/** Where a pointer is on the page, given where the frame is drawn and how big the page's viewport is. */
export function pagePoint(event: { clientX: number; clientY: number }, drawn: { left: number; top: number; width: number; height: number }, page: { width: number; height: number }) {
  return { x: ((event.clientX - drawn.left) * page.width) / Math.max(drawn.width, 1), y: ((event.clientY - drawn.top) * page.height) / Math.max(drawn.height, 1) };
}

export function mouseInput(action: "move" | "down" | "up", event: Modifiers & { button: number; detail: number }, point: { x: number; y: number }): BrowserInput {
  return { type: "mouse", action, ...point, button: BUTTONS[event.button] ?? "left", clickCount: Math.min(3, Math.max(1, event.detail)), modifiers: modifiersOf(event) };
}

export function keyInput(action: "down" | "up", event: Modifiers & { key: string; code: string; keyCode: number }): BrowserInput {
  const text = TEXT_KEYS[event.key] ?? (event.key.length === 1 && !event.ctrlKey && !event.metaKey ? event.key : undefined);
  return { type: "key", action, key: event.key, code: event.code, ...(text ? { text } : {}), keyCode: event.keyCode, modifiers: modifiersOf(event) };
}

export function addressToUrl(value: string): string | null {
  const text = value.trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
