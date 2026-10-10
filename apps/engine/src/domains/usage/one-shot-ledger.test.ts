import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendOneShotUsage } from "./one-shot-ledger";
import { readUsageReport } from "./scan";

const roots: string[] = [];
const tmp = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-one-shot-"));
  roots.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const AT = Date.UTC(2026, 9, 10, 12);

test("a plugin's one-shot completions show in the usage report beside the provider's turns", async () => {
  const base = tmp();
  const ledger = path.join(base, "usage-one-shot.jsonl");
  const tokens = { input: 40, output: 10, cacheRead: 0, cacheCreate: 0 };
  appendOneShotUsage(ledger, { at: AT, driver: "claude", model: "claude-haiku-4-5", tokens, costUsd: 0.001, source: "plugin:latex" });
  appendOneShotUsage(ledger, { at: AT + 60_000, driver: "claude", model: "claude-haiku-4-5", tokens, source: "plugin:latex" });
  appendOneShotUsage(ledger, { at: AT - 10 * 86_400_000, driver: "claude", model: "claude-haiku-4-5", tokens, costUsd: 9, source: "plugin:latex" });
  fs.appendFileSync(ledger, "not json\n");

  const report = await readUsageReport(
    { sinceMs: AT - 86_400_000, untilMs: AT + 86_400_000, resolution: "day", timeZone: "UTC" },
    {
      roots: { claude: path.join(base, "none"), codex: path.join(base, "none") },
      ratesCachePath: path.join(base, "rates.json"),
      oneShotPath: ledger,
      loadRatesTable: () => Promise.resolve({ status: "fresh", rates: new Map([["claude-haiku-4-5", { inputPerTok: 1e-6, outputPerTok: 5e-6 }]]) }),
      memo: false,
    },
  );
  expect(report.buckets).toEqual([
    { period: "2026-10-10", driver: "claude", model: "claude-haiku-4-5", tokens: { input: 80, output: 20, cacheRead: 0, cacheCreate: 0 }, costUsd: 0.001 + 40e-6 + 50e-6, priced: true, turns: 2 },
  ]);
});
