import type { ProviderDriverKind } from "@telar/engine-client";
import { BUNDLED_MANIFEST, claudeTierOf, codexTierOf, type ModelManifest } from "./manifest";

const FAMILY_TIERS: readonly [RegExp, number][] = [
  [/\b(haiku|luna|flash|lite|mini|nano|spark)\b/, 1],
  [/\bfable\b/, 4],
  [/\b(opus|astra)\b|^gpt\b.*\b(pro|max)\b/, 3],
  [/\b(sonnet|sol|terra)\b|^gemini\b.*\bpro\b|^(gpt|grok)\b/, 2],
  [/^(kimi|glm|deepseek|composer)\b/, 1],
];

function familyTierOf(id: string): number | undefined {
  const name = id.toLowerCase().replace(/\[.*$/, "").replace(/^.*\//, "");
  return FAMILY_TIERS.find(([family]) => family.test(name))?.[1];
}

export function tierOf(driver: ProviderDriverKind, id: string, manifest: ModelManifest = BUNDLED_MANIFEST): number | undefined {
  if (driver === "claude") return claudeTierOf(id, manifest);
  if (driver === "codex") return codexTierOf(id, manifest);
  return familyTierOf(id);
}
