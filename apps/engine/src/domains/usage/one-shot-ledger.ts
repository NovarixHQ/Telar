import fs from "node:fs";
import path from "node:path";
import type { ProviderDriverKind, TokenUsage } from "@telar/engine-client";
import type { UsageRecord } from "./log-parse";

export type OneShotUsage = { at: number; driver: ProviderDriverKind; model: string; tokens: TokenUsage; costUsd?: number; source: string };

export function appendOneShotUsage(file: string, entry: OneShotUsage): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

export function readOneShotUsage(file: string | undefined, sinceMs: number): { driver: ProviderDriverKind; record: UsageRecord }[] {
  if (!file) return [];
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      const entry = JSON.parse(line) as OneShotUsage;
      if (typeof entry.at !== "number" || entry.at < sinceMs || typeof entry.model !== "string" || !entry.tokens) return [];
      return [{ driver: entry.driver, record: { at: entry.at, model: entry.model, tokens: entry.tokens, sessionId: entry.source, ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}) } }];
    } catch {
      return [];
    }
  });
}
