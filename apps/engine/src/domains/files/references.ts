import fs from "node:fs";
import path from "node:path";
import type { FileReference, WorkspaceListing } from "@telar/engine-client";

const POSITION = /(?::(\d+)(?:[:-]\d+)?|#L(\d+)(?:-L?\d+)?)$/;

/** `src/a.ts:42` → the path and its line; text that cannot be a path is refused before any disk read. */
export function parseFileReference(text: string): { target: string; line?: number } | undefined {
  const trimmed = text.trim();
  if (!trimmed || /[\s`'"<>|*?]/.test(trimmed) || trimmed.includes("://")) return undefined;
  const position = POSITION.exec(trimmed);
  const target = (position ? trimmed.slice(0, position.index) : trimmed).replace(/^\.\//, "");
  const base = target.slice(target.lastIndexOf("/") + 1);
  if (!base || (!base.includes(".") && !target.includes("/"))) return undefined;
  const line = position ? Number(position[1] ?? position[2]) : 0;
  return line > 0 ? { target, line } : { target };
}

function uniqueSuffixMatch(files: readonly string[], target: string): string | undefined {
  const suffix = `/${target}`;
  let found: string | undefined;
  for (const file of files) {
    if (file !== target && !file.endsWith(suffix)) continue;
    if (found !== undefined) return undefined;
    found = file;
  }
  return found;
}

/**
 * The texts that name a file inside `root`: an exact path first, then a bare or partial path
 * that ends exactly one listed file. A truncated listing cannot prove a match is the only one.
 */
export async function resolveFileReferences(
  root: string,
  texts: readonly string[],
  listing: () => Promise<WorkspaceListing>,
): Promise<FileReference[]> {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  let listed: Promise<readonly string[]> | undefined;
  const resolve = async (text: string): Promise<FileReference | undefined> => {
    const parsed = parseFileReference(text);
    if (!parsed) return undefined;
    const absolute = path.resolve(root, parsed.target);
    let found: string | undefined;
    if (absolute.startsWith(prefix) && (await fs.promises.stat(absolute).catch(() => undefined))?.isFile()) {
      found = path.relative(root, absolute).split(path.sep).join("/");
    } else if (!path.isAbsolute(parsed.target) && !parsed.target.startsWith("../")) {
      listed ??= listing().then((answer) => (answer.truncated ? [] : answer.files)).catch(() => []);
      found = uniqueSuffixMatch(await listed, parsed.target);
    }
    if (!found) return undefined;
    return parsed.line ? { text, path: found, line: parsed.line } : { text, path: found };
  };
  const answers = await Promise.all([...new Set(texts)].map(resolve));
  return answers.filter((answer): answer is FileReference => answer !== undefined);
}
