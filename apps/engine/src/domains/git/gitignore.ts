import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GitignoreResult } from "@telar/engine-client";

export type IgnoreRule = { rule: string; alreadyCovered: string[]; why: string };

const HEADER = "# Telar — local state, not for sharing";

function existingRules(contents: string): Set<string> {
  return new Set(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

export function ensureTelarGitignore(root: string, rules: IgnoreRule[]): GitignoreResult {
  const file = path.join(root, ".gitignore");
  let contents = "";
  let created = false;
  try {
    contents = readFileSync(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    created = true;
  }

  const already = existingRules(contents);
  const added: string[] = [];
  const present: string[] = [];
  for (const entry of rules) {
    if (entry.alreadyCovered.some((pattern) => already.has(pattern))) present.push(entry.rule);
    else added.push(entry.rule);
  }
  if (added.length === 0) return { added, present, path: file, created: false };

  const prefix = contents.length > 0 && !contents.endsWith("\n") ? `${contents}\n` : contents;
  const gap = prefix.length > 0 && !prefix.endsWith("\n\n") ? "\n" : "";
  const block = [HEADER, ...added].join("\n");
  writeFileSync(file, `${prefix}${gap}${block}\n`, "utf8");
  return { added, present, path: file, created };
}
