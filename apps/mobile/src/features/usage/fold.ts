import type { TokenUsage, UsageBucket, UsageReport } from "@telar/engine-client";

type UsageTotals = { tokens: TokenUsage; processed: number; costUsd: number; priced: boolean; turns: number };
type ProviderSlice = { driver: string; totals: UsageTotals; share: number };
export type UsageFold = { total: UsageTotals; providers: ProviderSlice[]; sessions: number };

export const usageWindows = [
  { id: "24h", ms: 24 * 3_600_000, resolution: "hour" },
  { id: "7d", ms: 7 * 86_400_000, resolution: "day" },
  { id: "30d", ms: 30 * 86_400_000, resolution: "day" },
] as const;
export type UsageWindow = (typeof usageWindows)[number];

const knownDrivers = ["claude", "codex", "opencode", "telar"];
const driverLabels: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode", telar: "Telar" };

export const driverLabel = (driver: string): string => driverLabels[driver] ?? driver;

const empty = (): UsageTotals => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, processed: 0, costUsd: 0, priced: true, turns: 0 });

function add(totals: UsageTotals, bucket: UsageBucket): void {
  const { input, output, cacheRead, cacheCreate } = bucket.tokens;
  totals.tokens = { input: totals.tokens.input + input, output: totals.tokens.output + output, cacheRead: totals.tokens.cacheRead + cacheRead, cacheCreate: totals.tokens.cacheCreate + cacheCreate };
  totals.processed += input + output + cacheRead + cacheCreate;
  totals.costUsd += bucket.costUsd;
  totals.priced &&= bucket.priced;
  totals.turns += bucket.turns;
}

/** One total and one slice per provider, known providers first in a fixed order, the rest by name. */
export function foldUsage(report: UsageReport): UsageFold {
  const total = empty();
  const byDriver = new Map<string, UsageTotals>();
  for (const bucket of report.buckets) {
    add(total, bucket);
    const slice = byDriver.get(bucket.driver) ?? empty();
    add(slice, bucket);
    byDriver.set(bucket.driver, slice);
  }
  const order = [...knownDrivers.filter((driver) => byDriver.has(driver)), ...[...byDriver.keys()].filter((driver) => !knownDrivers.includes(driver)).sort()];
  const providers = order.flatMap((driver) => {
    const totals = byDriver.get(driver)!;
    if (totals.processed === 0 && totals.turns === 0) return [];
    return [{ driver, totals, share: total.processed > 0 ? totals.processed / total.processed : 0 }];
  });
  return { total, providers, sessions: report.sessions };
}

export const formatUsd = (value: number): string => `$${value.toFixed(2)}`;
export const formatShare = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  for (const [scale, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (value < scale) continue;
    const scaled = value / scale;
    return `${scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}${suffix}`;
  }
  return String(value);
}

export function headline(fold: UsageFold): string {
  return `${formatTokens(fold.total.processed)} tokens · ${fold.sessions} session${fold.sessions === 1 ? "" : "s"} · API estimate`;
}

export function scannedNote(report: UsageReport): string {
  const sources = report.sources.map((source) =>
    source.status === "ok" ? `${driverLabel(source.provider)}: ${source.sessions} session${source.sessions === 1 ? "" : "s"} scanned` : `${driverLabel(source.provider)}: no transcripts at ${source.path}`,
  );
  return sources.join(" · ") + (report.pricing === "unavailable" ? " · Rate table unreachable — unreported costs are not counted." : "");
}
