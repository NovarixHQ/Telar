import type { AgentModelChoice, DelegationMode, ProviderDriverKind, ProviderModel } from "@telar/engine-client";
import { offeredRows, rowNamed } from "./model-choices";
import { tierOf } from "./tiers";

const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const rank = (effort: string): number => EFFORT_ORDER.indexOf(effort);

const CAPS: Record<Exclude<DelegationMode, "aggressive">, { tier: number; effort: string }> = {
  conservative: { tier: 2, effort: "medium" },
  normal: { tier: 3, effort: "high" },
};
const UNNAMED = { tier: 2, effort: "medium" };

export type DelegationInput = {
  mode: DelegationMode;
  driver: ProviderDriverKind;
  rows: readonly ProviderModel[] | undefined;
  choice: AgentModelChoice;
  personSaid?: string;
  nearLimit?: NearLimit;
};

type NearLimit = { label: string; usedPercent: number };
export type Delegated = { choice: AgentModelChoice; note?: string };

const MODE_NAMES = { conservative: "Conservative", normal: "Normal" } as const;

function namedBy(text: string, row: ProviderModel): boolean {
  const words = new Set(`${row.id} ${row.label}`.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3 && word !== "claude" && word !== "gpt"));
  return [...words].some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

function bestUnder(driver: ProviderDriverKind, rows: readonly ProviderModel[], tier: number): ProviderModel | undefined {
  const under = rows
    .map((row) => ({ row, tier: tierOf(driver, row.id) }))
    .filter((entry): entry is { row: ProviderModel; tier: number } => entry.tier !== undefined && entry.tier <= tier);
  const top = Math.max(...under.map((entry) => entry.tier));
  const best = under.filter((entry) => entry.tier === top).map((entry) => entry.row);
  return best.find((row) => row.isDefault) ?? best.find((row) => row.defaultWindow) ?? best.find((row) => !/\[1m\]$/i.test(row.id)) ?? best[0];
}

function cappedEffort(row: ProviderModel, wanted: string | undefined, cap: string): string | undefined {
  if (row.efforts.length === 0) return undefined;
  if (wanted !== undefined && rank(wanted) <= rank(cap)) return wanted;
  if (wanted === undefined && row.defaultEffort && rank(row.defaultEffort) >= 0 && rank(row.defaultEffort) <= rank(cap)) return undefined;
  if (row.efforts.includes(cap)) return cap;
  const allowed = row.efforts.filter((effort) => rank(effort) >= 0 && rank(effort) <= rank(cap));
  return allowed.sort((a, b) => rank(b) - rank(a))[0] ?? row.efforts[0];
}

export function delegatedChoice(input: DelegationInput): Delegated {
  const { mode, driver, choice, nearLimit } = input;
  if (mode === "aggressive" || !input.rows) return { choice };
  const offered = offeredRows(driver, input.rows);
  const named = choice.model ? rowNamed(driver, offered, choice.model) : undefined;
  if (choice.model && !named) return { choice };
  if (named && input.personSaid && namedBy(input.personSaid, named)) return { choice };
  const cap = CAPS[mode];
  const namedTier = named ? tierOf(driver, named.id) : undefined;
  if (named && namedTier === undefined) return { choice };
  const keep = named && namedTier !== undefined && namedTier <= cap.tier ? named : undefined;
  const capped = keep ?? bestUnder(driver, offered, named ? cap.tier : UNNAMED.tier);
  if (!capped) return { choice };
  const cappedTier = tierOf(driver, capped.id) ?? 1;
  const lower = nearLimit && cappedTier > 1 ? bestUnder(driver, offered, cappedTier - 1) : undefined;
  const row = lower ?? capped;
  const effort = cappedEffort(row, choice.effort, named || choice.effort ? cap.effort : UNNAMED.effort);
  const notes = [
    (named && capped !== named) || (choice.effort && effort !== choice.effort)
      ? `The person's ${MODE_NAMES[mode]} delegation mode allows builders up to tier ${cap.tier} at ${cap.effort} effort.`
      : undefined,
    lower && nearLimit ? `${nearLimit.label} is ${Math.round(nearLimit.usedPercent)}% used, so this builder runs one tier lower.` : undefined,
  ].filter((note): note is string => note !== undefined);
  return { choice: { model: row.id, ...(effort ? { effort } : {}) }, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
}
