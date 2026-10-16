import { promises as fsAsync, type Dirent } from "node:fs";
import path from "node:path";
import type { WorkspaceDirectory, WorkspaceEntry } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel";
import type { AsyncGitRunner } from "../../platform/git/runner";

export const MAX_DIRECTORY_ENTRIES = 2_000;

const IGNORE_CHECK_BATCH = 500;

const IGNORE_CHECK_TIMEOUT_MS = 5_000;

const within = (parent: string, child: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);

const toSlash = (relative: string) => relative.split(path.sep).join("/");

async function fencedDirectory(root: string, dir: string, label: string): Promise<{ absolute: string; real: string; rootReal: string }> {
  const absolute = path.resolve(root, dir);
  if (!within(root, absolute)) throw new EngineStateError("invalid_request", `that path is outside the ${label}`);
  const [real, rootReal] = await Promise.all([fsAsync.realpath(absolute), fsAsync.realpath(root)]).catch(() => {
    throw new EngineStateError("not_found", "no such directory in this workspace");
  });
  if (!within(rootReal, real)) throw new EngineStateError("invalid_request", `that path is outside the ${label}`);
  if (!(await fsAsync.stat(real)).isDirectory()) throw new EngineStateError("invalid_request", "that path is not a directory");
  return { absolute, real, rootReal };
}

async function readEntries(absolute: string): Promise<{ entries: Dirent[]; truncated: boolean }> {
  const entries: Dirent[] = [];
  try {
    for await (const entry of await fsAsync.opendir(absolute)) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) return { entries, truncated: true };
      entries.push(entry);
    }
  } catch {
    throw new EngineStateError("invalid_request", "that directory could not be read");
  }
  return { entries, truncated: false };
}

async function followLink(target: string, place: { real: string; rootReal: string }): Promise<Pick<WorkspaceEntry, "kind" | "symlink">> {
  const real = await fsAsync.realpath(target).catch(() => undefined);
  if (!real || !within(place.rootReal, real)) return { kind: "link", symlink: true };
  const stats = await fsAsync.stat(real).catch(() => undefined);
  if (stats?.isFile()) return { kind: "file", symlink: true };
  if (!stats?.isDirectory() || within(real, place.real)) return { kind: "link", symlink: true };
  return { kind: "directory", symlink: true };
}

async function ignoredNames(git: AsyncGitRunner, cwd: string, names: string[]): Promise<Set<string>> {
  const batches: string[][] = [];
  for (let start = 0; start < names.length; start += IGNORE_CHECK_BATCH) batches.push(names.slice(start, start + IGNORE_CHECK_BATCH));
  const results = await Promise.all(
    batches.map((batch) => git(cwd, ["-c", "core.quotePath=false", "check-ignore", "--", ...batch], { timeoutMs: IGNORE_CHECK_TIMEOUT_MS }).catch(() => undefined)),
  );
  const ignored = new Set<string>();
  for (const result of results) {
    if (!result || result.timedOut || result.status !== 0) continue;
    for (const line of result.stdout.split("\n")) if (line) ignored.add(line);
  }
  return ignored;
}

const compareEntries = (left: WorkspaceEntry, right: WorkspaceEntry) => {
  if ((left.kind === "directory") !== (right.kind === "directory")) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
};

export async function listWorkspaceDirectory(git: AsyncGitRunner, input: { root: string; dir: string; label: string }): Promise<WorkspaceDirectory> {
  const place = await fencedDirectory(input.root, input.dir, input.label);
  const { entries, truncated } = await readEntries(place.absolute);
  const prefix = toSlash(path.relative(input.root, place.absolute));
  const [ignored, listed] = await Promise.all([
    ignoredNames(git, place.absolute, entries.map((entry) => entry.name)),
    Promise.all(
      entries.map(async (entry): Promise<WorkspaceEntry | undefined> => {
        const absolute = path.join(place.absolute, entry.name);
        const base = { name: entry.name, path: prefix ? `${prefix}/${entry.name}` : entry.name };
        if (entry.isSymbolicLink()) return { ...base, ...(await followLink(absolute, place)) };
        if (entry.isFile()) return { ...base, kind: "file" };
        if (!entry.isDirectory()) return undefined;
        const nested = await fsAsync.access(path.join(absolute, ".git")).then(() => true, () => false);
        return nested ? { ...base, kind: "directory", submodule: true } : { ...base, kind: "directory" };
      }),
    ),
  ]);
  const shown = listed
    .filter((entry): entry is WorkspaceEntry => entry !== undefined)
    .map((entry): WorkspaceEntry => (ignored.has(entry.name) ? { ...entry, ignored: true } : entry))
    .sort(compareEntries);
  return { path: prefix, entries: shown, truncated };
}
