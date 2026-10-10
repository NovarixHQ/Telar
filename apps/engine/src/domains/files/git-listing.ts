import { promises as fsAsync } from "node:fs";
import path from "node:path";
import { nulFields } from "../../platform/git/parse";
import type { AsyncGitRunner } from "../../platform/git/runner";

const MAX_SUBMODULE_DEPTH = 6;

const GITLINK_MODE = "160000";

export type GitListing = { files: string[]; submodules: string[] };

function failed(result: { timedOut?: true; stderr: string }): void {
  if (result.timedOut) throw new Error(result.stderr || "Git file listing timed out");
}

async function gitlinks(git: AsyncGitRunner, cwd: string): Promise<Set<string>> {
  const staged = await git(cwd, ["ls-files", "--stage", "-z"]);
  failed(staged);
  const links = new Set<string>();
  if (staged.status !== 0) return links;
  for (const entry of nulFields(staged.stdout)) {
    if (entry.startsWith(`${GITLINK_MODE} `)) links.add(entry.slice(entry.indexOf("\t") + 1));
  }
  return links;
}

/** Submodules and untracked nested repositories come back as folders, expanded from their own tree when checked out. */
export async function gitListing(git: AsyncGitRunner, cwd: string, depth = 0): Promise<GitListing | undefined> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree", "--show-prefix", "--show-toplevel"]);
  failed(inside);
  const [isInside, prefix = "", toplevel] = inside.stdout.split("\n");
  if (inside.status !== 0 || isInside?.trim() !== "true") return undefined;
  // An uninitialised submodule is an empty folder inside its parent's work tree.
  if (depth > 0 && prefix !== "") return undefined;
  const listed = await git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z"]);
  failed(listed);
  if (listed.status !== 0) return { files: [], submodules: [] };

  const modules = toplevel ? await fsAsync.access(path.join(toplevel, ".gitmodules")).then(() => true, () => false) : false;
  const links = modules ? await gitlinks(git, cwd) : new Set<string>();
  const files: string[] = [];
  const submodules: string[] = [];
  for (const entry of nulFields(listed.stdout)) {
    if (!entry) continue;
    if (links.has(entry) || entry.endsWith("/")) submodules.push(entry.replace(/\/$/, ""));
    else files.push(entry);
  }
  if (depth >= MAX_SUBMODULE_DEPTH) return { files, submodules };

  const nested = await Promise.all(submodules.map((sub) => gitListing(git, path.join(cwd, sub), depth + 1).catch(() => undefined)));
  nested.forEach((inner, index) => {
    if (!inner) return;
    const sub = submodules[index]!;
    for (const file of inner.files) files.push(`${sub}/${file}`);
    for (const deeper of inner.submodules) submodules.push(`${sub}/${deeper}`);
  });
  return { files, submodules };
}
