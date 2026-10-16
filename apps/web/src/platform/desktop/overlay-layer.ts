"use client";

import { useEffect, useSyncExternalStore } from "react";

type Rect = { x: number; y: number; width: number; height: number };

type OverlayBridge = {
  setRect: (rect: Rect | null) => void;
  onOutside: (listener: () => void) => () => void;
};

const FRAME = "telar-overlay";
const SHADOW = 8;
const PRESS_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const;

function overlayBridge(): OverlayBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { telarDesktop?: { overlay?: OverlayBridge } }).telarDesktop?.overlay;
}

let root: HTMLElement | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const tracked = new Set<Element>();
let offset = { x: 0, y: 0 };
let sent = "";
let frame = 0;
let candidate = "";
let stopWatching: (() => void) | null = null;

function publish(): void {
  for (const listener of listeners) listener();
}

function mirrorAttributes(from: Element, to: Element): void {
  for (const name of to.getAttributeNames()) if (!from.hasAttribute(name)) to.removeAttribute(name);
  for (const name of from.getAttributeNames()) to.setAttribute(name, from.getAttribute(name) ?? "");
}

let shifter: HTMLElement | null = null;

function shift(): void {
  if (!shifter) return;
  Object.assign(shifter.style, {
    position: "absolute",
    width: `${window.innerWidth}px`,
    height: `${window.innerHeight}px`,
    transform: `translate(${-offset.x}px,${-offset.y}px)`,
  });
}

function forwardKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
  const copy = new KeyboardEvent("keydown", { key: event.key, code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, cancelable: true });
  window.dispatchEvent(copy);
  if (copy.defaultPrevented) event.preventDefault();
}

function mirrorStyles(doc: Document, copies: Map<Node, Element>): void {
  const sources = [...document.querySelectorAll('link[rel="stylesheet"], style')];
  for (const [source, copy] of copies) {
    if (sources.includes(source as Element)) continue;
    copy.remove();
    copies.delete(source);
  }
  for (const source of sources) {
    let copy = copies.get(source);
    if (!copy) {
      copy = doc.importNode(source, true) as Element;
      if (source instanceof HTMLLinkElement) copy.setAttribute("href", source.href);
      copies.set(source, copy);
    } else if (source.tagName === "STYLE" && copy.textContent !== source.textContent) {
      copy.textContent = source.textContent;
    }
    doc.head.append(copy);
  }
}

function mirror(doc: Document): () => void {
  const copies = new Map<Node, Element>();
  const base = doc.createElement("style");
  base.textContent = "html,body{margin:0;background:transparent!important}::-webkit-scrollbar{display:none}";
  const syncStyles = () => {
    mirrorStyles(doc, copies);
    doc.head.append(base);
  };
  const syncAttributes = () => {
    mirrorAttributes(document.documentElement, doc.documentElement);
    mirrorAttributes(document.body, doc.body);
  };
  syncStyles();
  syncAttributes();
  const styles = new MutationObserver(syncStyles);
  styles.observe(document.head, { childList: true, subtree: true, characterData: true });
  const attributes = new MutationObserver(syncAttributes);
  attributes.observe(document.documentElement, { attributes: true });
  attributes.observe(document.body, { attributes: true });
  return () => {
    styles.disconnect();
    attributes.disconnect();
  };
}

function replay(doc: Document, type: string, from?: Event): void {
  const init: PointerEventInit = { bubbles: true, button: from instanceof MouseEvent ? from.button : 0, pointerType: from instanceof PointerEvent ? from.pointerType : "mouse" };
  doc.documentElement.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
}

function watchOutside(doc: Document, bridge: OverlayBridge): () => void {
  const forward = (event: Event) => {
    if (tracked.size === 0 || (event.target instanceof Element && event.target.closest("[data-popup-open]"))) return;
    replay(doc, event.type, event);
  };
  for (const type of PRESS_EVENTS) document.addEventListener(type, forward, true);
  const stop = bridge.onOutside(() => {
    for (const type of PRESS_EVENTS) replay(doc, type);
  });
  doc.addEventListener("keydown", forwardKey);
  return () => {
    for (const type of PRESS_EVENTS) document.removeEventListener(type, forward, true);
    doc.removeEventListener("keydown", forwardKey);
    stop();
  };
}

function open(bridge: OverlayBridge): HTMLElement | null {
  if (root?.isConnected) return root;
  const child = window.open("", FRAME);
  if (!child) return null;
  const doc = child.document;
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  stopWatching?.();
  const stopMirror = mirror(doc);
  const stopOutside = watchOutside(doc, bridge);
  stopWatching = () => {
    stopMirror();
    stopOutside();
  };
  sent = "";
  offset = { x: 0, y: 0 };
  shifter = doc.createElement("div");
  root = doc.createElement("div");
  root.dataset.overlayLayer = "";
  shifter.append(root, originProbe(doc));
  doc.body.append(shifter);
  cockpitViewport(child);
  shift();
  return root;
}

// floating-ui measures an anchor in another window through that window's frameElement, so the
// cockpit reports a probe sitting at its own origin inside the shifted overlay document.
function originProbe(doc: Document): HTMLElement {
  const probe = doc.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
  Object.defineProperty(window, "frameElement", { configurable: true, get: () => (tracked.size > 0 && probe.isConnected ? probe : null) });
  return probe;
}

function cockpitViewport(child: Window): void {
  const real = child.visualViewport;
  if (!real) return;
  const viewport = new Proxy(real, {
    get(target, key) {
      if (key === "width") return window.innerWidth;
      if (key === "height") return window.innerHeight;
      if (key === "offsetLeft") return -offset.x;
      if (key === "offsetTop") return -offset.y;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(child, "visualViewport", { configurable: true, get: () => viewport });
}

function settled(doc: Document): boolean {
  if (doc.fonts && doc.fonts.status !== "loaded") return false;
  const view = doc.defaultView;
  return [...tracked].every((element) => view?.getComputedStyle(element).opacity !== "0");
}

function union(elements: Iterable<Element>): Rect | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export function overlayRect(shape: Rect | null, at: { x: number; y: number }, viewport: { width: number; height: number }): Rect | null {
  if (!shape) return null;
  const x = Math.max(0, Math.floor(shape.x + at.x - SHADOW));
  const y = Math.max(0, Math.floor(shape.y + at.y - SHADOW));
  const right = Math.min(viewport.width, Math.ceil(shape.x + at.x + shape.width + SHADOW));
  const bottom = Math.min(viewport.height, Math.ceil(shape.y + at.y + shape.height + SHADOW));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function measure(): void {
  frame = 0;
  const bridge = overlayBridge();
  if (!bridge || !root) return;
  const rect = overlayRect(union(tracked), offset, { width: window.innerWidth, height: window.innerHeight });
  const key = rect ? `${rect.x},${rect.y},${rect.width},${rect.height}@${window.innerWidth}x${window.innerHeight}` : "";
  const waiting = sent === "" && rect !== null && (key !== candidate || !settled(root.ownerDocument));
  candidate = key;
  if (key !== sent && !waiting) {
    if (sent === "" && rect) announceShown();
    sent = key;
    offset = rect ? { x: rect.x, y: rect.y } : { x: 0, y: 0 };
    shift();
    bridge.setRect(rect);
  }
  if (tracked.size > 0) frame = window.requestAnimationFrame(measure);
}

const shownListeners = new Set<() => void>();

function announceShown(): void {
  const waiting = [...shownListeners];
  shownListeners.clear();
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => waiting.forEach((run) => run())));
}

export function afterOverlayShows(run: () => void): () => void {
  if (!root || hosts === 0 || sent !== "") {
    run();
    return () => undefined;
  }
  shownListeners.add(run);
  return () => void shownListeners.delete(run);
}

export function trackOverlayElement(element: Element): () => void {
  tracked.add(element);
  if (!frame) frame = window.requestAnimationFrame(measure);
  return () => {
    tracked.delete(element);
    if (!frame) frame = window.requestAnimationFrame(measure);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const activeRoot = () => (hosts > 0 ? root : null);

export function useOverlayLayer(): HTMLElement | null {
  return useSyncExternalStore(subscribe, activeRoot, () => null);
}

export function useOverlayLayerHost(): void {
  useEffect(() => {
    const bridge = overlayBridge();
    if (!bridge || !open(bridge)) return;
    hosts += 1;
    publish();
    return () => {
      hosts -= 1;
      publish();
    };
  }, []);
}
