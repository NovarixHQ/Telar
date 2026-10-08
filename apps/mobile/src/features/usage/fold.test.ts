import { describe, expect, test } from "bun:test";
import type { UsageBucket, UsageReport } from "@telar/engine-client";
import { foldUsage, formatShare, formatTokens, formatUsd, headline, scannedNote } from "./fold";

const bucket = (driver: string, input: number, costUsd: number, priced = true): UsageBucket =>
  ({ period: "2026-10-08", driver, model: "m", tokens: { input, output: 0, cacheRead: 0, cacheCreate: 0 }, costUsd, priced, turns: 1 }) as UsageBucket;

const report = (buckets: UsageBucket[], extra: Partial<UsageReport> = {}): UsageReport => ({
  sinceMs: 0,
  untilMs: 1,
  resolution: "day",
  timeZone: "UTC",
  buckets,
  sources: [],
  pricing: "fresh",
  sessions: 2,
  readAt: 1,
  ...extra,
});

describe("foldUsage", () => {
  test("totals every bucket and orders known providers first, then the rest by name", () => {
    const fold = foldUsage(report([bucket("zed", 100, 0), bucket("codex", 300, 1), bucket("claude", 600, 2), bucket("codex", 0, 0)]));
    expect(fold.total.processed).toBe(1000);
    expect(fold.total.costUsd).toBe(3);
    expect(fold.providers.map((p) => [p.driver, p.share])).toEqual([
      ["claude", 0.6],
      ["codex", 0.3],
      ["zed", 0.1],
    ]);
  });

  test("one unpriced bucket makes the total unpriced", () => {
    expect(foldUsage(report([bucket("claude", 1, 0, false), bucket("claude", 1, 1)])).total.priced).toBe(false);
  });

  test("an empty window has no providers and no share", () => {
    expect(foldUsage(report([])).providers).toEqual([]);
  });
});

describe("formatting", () => {
  test("matches the Swift app's figures", () => {
    expect(formatUsd(3.456)).toBe("$3.46");
    expect(formatShare(0.1234)).toBe("12.3%");
    expect([formatTokens(999), formatTokens(1234), formatTokens(56_700), formatTokens(123_456_789)]).toEqual(["999", "1.23K", "56.7K", "123M"]);
  });

  test("the headline and scan note read like Swift's", () => {
    expect(headline(foldUsage(report([bucket("claude", 1500, 1)], { sessions: 1 })))).toBe("1.50K tokens · 1 session · API estimate");
    const note = scannedNote(
      report([], {
        pricing: "unavailable",
        sources: [
          { provider: "claude", status: "ok", path: "~/.claude", files: 3, sessions: 4 },
          { provider: "codex", status: "missing", path: "~/.codex", files: 0, sessions: 0 },
        ],
      }),
    );
    expect(note).toBe("Claude: 4 sessions scanned · Codex: no transcripts at ~/.codex · Rate table unreachable — unreported costs are not counted.");
  });
});
