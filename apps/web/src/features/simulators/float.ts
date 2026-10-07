"use client";

import { useSyncExternalStore } from "react";
import type { SimulatorSummary } from "@telar/engine-client";

type Box = { width: number; height: number };
type Point = { x: number; y: number };
export type FloatFrame = Point & Box;
export type FloatSpot = Point & { width: number };
export type Corner = "nw" | "ne" | "sw" | "se";
export type SimulatorFloat = { simulator?: SimulatorSummary; spot?: FloatSpot };

export const FLOAT_GAP = 12;
const MIN_WIDTH = 120;
const FRESH_HEIGHT = 420;
const STORAGE_KEY = "telar:simulator-float";
const KEPT_SESSIONS = 100;
const NONE: SimulatorFloat = {};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function inside(point: Point, size: Box, room: Box): Point {
  return { x: clamp(point.x, FLOAT_GAP, room.width - FLOAT_GAP - size.width), y: clamp(point.y, FLOAT_GAP, room.height - FLOAT_GAP - size.height) };
}

function widthWithin(wanted: number, aspect: number, roomWidth: number, roomHeight: number): number {
  const most = Math.max(0, Math.min(roomWidth, roomHeight * aspect));
  return clamp(wanted, Math.min(MIN_WIDTH, most), most);
}

export function placeFloat(spot: FloatSpot | undefined, aspect: number, room: Box): FloatFrame {
  const width = widthWithin(spot?.width ?? FRESH_HEIGHT * aspect, aspect, room.width - 2 * FLOAT_GAP, room.height - 2 * FLOAT_GAP);
  const size = { width, height: width / aspect };
  return { ...size, ...inside(spot ?? { x: room.width, y: 0 }, size, room) };
}

export function dragFloat(start: FloatFrame, delta: Point, room: Box): FloatFrame {
  return { ...start, ...inside({ x: start.x + delta.x, y: start.y + delta.y }, start, room) };
}

export function resizeFloat(start: FloatFrame, corner: Corner, delta: Point, aspect: number, room: Box): FloatFrame {
  const east = corner.endsWith("e") ? 1 : -1;
  const south = corner.startsWith("s") ? 1 : -1;
  const across = east * delta.x;
  const down = south * delta.y * aspect;
  const anchor = { x: east > 0 ? start.x : start.x + start.width, y: south > 0 ? start.y : start.y + start.height };
  const roomWidth = east > 0 ? room.width - FLOAT_GAP - anchor.x : anchor.x - FLOAT_GAP;
  const roomHeight = south > 0 ? room.height - FLOAT_GAP - anchor.y : anchor.y - FLOAT_GAP;
  const width = widthWithin(start.width + (Math.abs(across) >= Math.abs(down) ? across : down), aspect, roomWidth, roomHeight);
  const height = width / aspect;
  return { x: east > 0 ? anchor.x : anchor.x - width, y: south > 0 ? anchor.y : anchor.y - height, width, height };
}

let floats: Record<string, SimulatorFloat> | undefined;
const listeners = new Set<() => void>();

function read(): Record<string, SimulatorFloat> {
  if (floats) return floats;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    floats = stored && typeof stored === "object" ? (stored as Record<string, SimulatorFloat>) : {};
  } catch {
    floats = {};
  }
  return floats;
}

function write(key: string, next: (current: SimulatorFloat) => SimulatorFloat) {
  const { [key]: current = NONE, ...rest } = read();
  const kept = Object.entries(rest).slice(-(KEPT_SESSIONS - 1));
  floats = { ...Object.fromEntries(kept), [key]: next(current) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(floats));
  } catch {
  }
  for (const listener of listeners) listener();
}

export const floatKey = (hostId: string | undefined, sessionId: string) => `${hostId ?? "local"}:${sessionId}`;

export function floatSimulator(key: string, simulator: SimulatorSummary) {
  write(key, (current) => ({ ...current, simulator }));
}

export function dockSimulator(key: string) {
  write(key, ({ spot }) => (spot ? { spot } : NONE));
}

export function keepFloatSpot(key: string, frame: FloatFrame) {
  write(key, (current) => ({ ...current, spot: { x: frame.x, y: frame.y, width: frame.width } }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSimulatorFloat(key: string | undefined): SimulatorFloat {
  return useSyncExternalStore(subscribe, () => (key ? (read()[key] ?? NONE) : NONE), () => NONE);
}
