"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ProviderDriverKind, Session, SessionDiff } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { usePoll } from "@/ui/hooks/use-poll";
import { parentIdOf } from "../../rail/flat-rail";
import { useRememberedRow } from "./use-remembered-row";

const OPEN_KEY = "telar:workspace-card";
const REFRESH_MS = 15_000;
const CARD_WIDTH = 288;
export const DOCK_GUTTER = CARD_WIDTH + 24;
const listeners = new Set<() => void>();

export type CardPlacement = "docked" | "popover";
let placement: CardPlacement = "docked";
let popoverOpen = false;

function readDocked(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const notify = () => {
  for (const listener of listeners) listener();
};

export function cardPlacement(chatWidth: number, laneWidth: number, panelOpen: boolean): CardPlacement {
  const margin = (chatWidth - Math.min(laneWidth, chatWidth)) / 2;
  return panelOpen || margin < DOCK_GUTTER ? "popover" : "docked";
}

function laneWidth(element: HTMLElement): number {
  const read = (node: Element) => getComputedStyle(node).getPropertyValue("--chat-content-max-width").trim();
  const value = read(element) || read(document.documentElement);
  if (value.endsWith("rem")) return parseFloat(value) * parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (value.endsWith("px")) return parseFloat(value);
  return element.clientWidth;
}

export function setCardPlacement(next: CardPlacement) {
  if (next === placement) return;
  placement = next;
  popoverOpen = false;
  notify();
}

/** Docked, the card stays where the person left it; as a popover it opens on demand and closes when it loses focus. */
export function useWorkspaceCardOpen(): { open: boolean; placement: CardPlacement; toggle: () => void; close: () => void } {
  const snapshot = useSyncExternalStore(subscribe, () => `${placement}:${placement === "docked" ? readDocked() : popoverOpen}`, () => "docked:false");
  const [shown, open] = snapshot.split(":") as [CardPlacement, string];
  const set = useCallback((next: boolean) => {
    if (placement === "popover") popoverOpen = next;
    else {
      try {
        window.localStorage.setItem(OPEN_KEY, next ? "open" : "closed");
      } catch {
        return;
      }
    }
    notify();
  }, []);
  const toggle = useCallback(() => set(placement === "popover" ? !popoverOpen : !readDocked()), [set]);
  const close = useCallback(() => set(false), [set]);
  return { open: open === "true", placement: shown, toggle, close };
}

export function useCardPlacement(panelOpen: boolean) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const place = () => setCardPlacement(cardPlacement(element.clientWidth, laneWidth(element), panelOpen));
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, panelOpen]);
  return setElement;
}

/** A shared checkout reads against `HEAD`, as the Diff surface does: the HEAD recorded at session start goes stale once the branch moves. */
export function useWorkspaceCardData(hostId: string, sessionId: string, open: boolean, shared: boolean, busy: boolean) {
  const [diff, setDiff] = useState<SessionDiff>();
  const load = useCallback(async () => {
    const read = await createEngineApi(hostFetcher(hostId)).sessionDiff(sessionId, shared ? { base: null } : {}).catch(() => undefined);
    if (read?.diff) setDiff(read.diff);
  }, [hostId, sessionId, shared]);
  usePoll(load, open ? REFRESH_MS : null, { key: load, backoff: !busy });
  return { diff, reload: load };
}

export type CardParent = { id: string; title: string; driver?: ProviderDriverKind; projectId?: string };

export function useParentSession(hostId: string, session: Session, open: boolean): CardParent | undefined {
  const own = useRememberedRow(hostId, session.id);
  const parentId = parentIdOf({ id: session.id, startedFrom: session.startedFrom ?? own?.startedFrom, assignments: own?.assignments });
  const cached = useRememberedRow(hostId, parentId);
  const [fetched, setFetched] = useState<CardParent>();
  useEffect(() => {
    if (!open || !parentId || cached || fetched?.id === parentId) return;
    let live = true;
    void createEngineApi(hostFetcher(hostId))
      .session(parentId, { turns: 1 })
      .then(({ session: parent }) => live && setFetched({ id: parent.id, title: parent.title, driver: parent.driver, ...(parent.projectId ? { projectId: parent.projectId } : {}) }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, hostId, parentId, cached, fetched?.id]);
  if (!parentId) return undefined;
  if (cached) return { id: cached.id, title: cached.title, driver: cached.driver, ...(cached.projectId ? { projectId: cached.projectId } : {}) };
  return fetched?.id === parentId ? fetched : { id: parentId, title: "Untitled" };
}
