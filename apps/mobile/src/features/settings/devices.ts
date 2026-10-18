import type { DevicePlatform, DeviceScope, RemoteDevice, RemoteState } from "@telar/engine-client";
import { canAdmin } from "../../platform/connection";

export type RemoteStatus = RemoteState & { callerDeviceId?: string; callerScopes?: DeviceScope[] };

export type Access = "full" | "edit" | "view";

export const ACCESS_SCOPES: Record<Access, DeviceScope[]> = { full: ["read", "write", "admin"], edit: ["read", "write"], view: ["read"] };

export const ACCESS_LABEL: Record<Access, string> = { full: "Full", edit: "Can edit", view: "View only" };

export const accessOf = (scopes: readonly DeviceScope[]): Access => (scopes.includes("admin") ? "full" : scopes.includes("write") ? "edit" : "view");

export type DevicesView = {
  canManage: boolean;
  mine: RemoteDevice[];
  others: RemoteDevice[];
  othersLabel: string;
  emptyTitle?: string;
  canRevokeOthers: boolean;
};

export function devicesView(status: RemoteStatus): DevicesView {
  const canManage = canAdmin(status.callerScopes);
  const mine = status.devices.filter((device) => device.id === status.callerDeviceId);
  const others = status.devices.filter((device) => device.id !== status.callerDeviceId);
  return {
    canManage,
    mine,
    others,
    othersLabel: mine.length > 0 ? "Other devices" : "Devices",
    ...(others.length === 0 ? { emptyTitle: mine.length > 0 ? "No other devices are paired." : "No devices are paired." } : {}),
    canRevokeOthers: canManage && others.length > 0 && status.callerDeviceId !== undefined,
  };
}

const steps: [string, number, string][] = [
  ["year", 31_536_000_000, "last year"],
  ["month", 2_592_000_000, "last month"],
  ["week", 604_800_000, "last week"],
  ["day", 86_400_000, "yesterday"],
  ["hour", 3_600_000, "1 hour ago"],
  ["minute", 60_000, "1 minute ago"],
];

/** Foundation's named relative style ("yesterday", "3 hours ago"); Hermes has no Intl.RelativeTimeFormat. */
export function ago(at: number, now: number): string {
  const elapsed = now - at;
  for (const [unit, size, single] of steps) {
    const count = Math.floor(elapsed / size);
    if (count >= 1) return count === 1 ? single : `${count} ${unit}s ago`;
  }
  return "now";
}

export function deviceSubtitle(device: RemoteDevice, now: number): string {
  if (device.connected) return "Connected";
  if (device.lastSeenAt) return `Last seen ${ago(device.lastSeenAt, now)}`;
  if (device.createdAt) return `Paired ${ago(device.createdAt, now)}`;
  return "Paired";
}

export function platformSymbol(platform: DevicePlatform | undefined): "iphone" | "desktopcomputer" | "questionmark.circle" {
  if (platform === "ios") return "iphone";
  if (platform === "browser") return "desktopcomputer";
  return "questionmark.circle";
}
