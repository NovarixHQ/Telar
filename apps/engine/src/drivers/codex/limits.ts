import type { UsageLimitWindow } from "@telar/engine-client";
import type { CodexAppServer } from "./app-server";
import { record } from "./items";

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const READ_TIMEOUT_MS = 15_000;

function windowLabel(minutes: number): string {
  if (minutes >= MONTH) return "month";
  if (minutes >= WEEK) return "week";
  if (minutes >= DAY) return `${Math.round(minutes / DAY)} d`;
  return `${Math.round(minutes / HOUR)} h`;
}

// `primary` and `secondary` are positions, not durations; without a duration, paid plans are 5 h + week and free ones a month.
export function codexLimitWindows(response: unknown): UsageLimitWindow[] {
  const snapshot = record(record(response).rateLimits);
  if (typeof snapshot.limitId === "string" && snapshot.limitId !== "codex") return [];
  const monthly = snapshot.planType === "free" || snapshot.planType === "go";
  const positions = [
    ["primary", monthly ? MONTH : 5 * HOUR],
    ["secondary", WEEK],
  ] as const;
  return positions.flatMap(([key, fallback]) => {
    const window = record(snapshot[key]);
    const used = window.usedPercent;
    if (typeof used !== "number" || !Number.isFinite(used)) return [];
    const minutes = typeof window.windowDurationMins === "number" && window.windowDurationMins > 0 ? window.windowDurationMins : fallback;
    const resetsAt = typeof window.resetsAt === "number" && window.resetsAt > 0 ? window.resetsAt * 1000 : undefined;
    return [{ key, label: windowLabel(minutes), usedPercent: Math.min(100, Math.max(0, used)), ...(resetsAt ? { resetsAt } : {}) }];
  });
}

export async function readCodexLimits(client: CodexAppServer): Promise<UsageLimitWindow[]> {
  await client.request("initialize", {
    clientInfo: { name: "telar", title: "Telar", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  }, READ_TIMEOUT_MS);
  client.notify("initialized");
  return codexLimitWindows(await client.request("account/rateLimits/read", null, READ_TIMEOUT_MS));
}
