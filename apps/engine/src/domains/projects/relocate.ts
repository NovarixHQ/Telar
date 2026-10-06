import fs from "node:fs/promises";
import path from "node:path";
import type { Session } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel";
import type { AsyncGitRunner } from "../../platform/git/runner";

const exists = (target: string) => fs.stat(target).then(() => true, () => false);

async function gitCommonDir(git: AsyncGitRunner, root: string): Promise<string | undefined> {
  const answer = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], { timeoutMs: 10_000 });
  const found = answer.status === 0 ? answer.stdout.trim() : "";
  return found ? fs.realpath(found).catch(() => undefined) : undefined;
}

async function belongsTo(commonDir: string, worktree: string): Promise<boolean> {
  try {
    const pointer = (await fs.readFile(path.join(worktree, ".git"), "utf8")).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    if (!pointer) return false;
    const back = (await fs.readFile(path.join(commonDir, "worktrees", path.basename(pointer), "gitdir"), "utf8")).trim();
    return (await fs.realpath(path.dirname(back))) === (await fs.realpath(worktree));
  } catch {
    return false;
  }
}

export async function planRelocation(
  git: AsyncGitRunner,
  input: { name: string; previousRoot: string; root: string; sessions: readonly Session[] },
): Promise<string[]> {
  const cut = input.sessions.flatMap((session) => (session.workspace.mode === "worktree" ? [session.workspace.path] : []));
  const wasGit = cut.length > 0 || ((await exists(input.previousRoot)) && (await gitCommonDir(git, input.previousRoot)) !== undefined);
  const commonDir = await gitCommonDir(git, input.root);
  if (wasGit && commonDir === undefined) {
    throw new EngineStateError("invalid_request", `${input.name} was a git repository and ${input.root} is not one. Choose the folder it was moved to.`);
  }
  if (commonDir === undefined) return [];
  const present = await Promise.all(cut.map(async (worktree) => ((await exists(worktree)) ? worktree : undefined)));
  const worktrees = present.filter((worktree) => worktree !== undefined);
  const strangers = (await Promise.all(worktrees.map((worktree) => belongsTo(commonDir, worktree)))).filter((owned) => !owned).length;
  if (strangers > 0) {
    throw new EngineStateError(
      "conflict",
      `${strangers === 1 ? "A worktree session was" : `${strangers} worktree sessions were`} cut from a different copy of this repository than ${input.root}, so ${strangers === 1 ? "it" : "they"} would stop working. Choose the folder ${input.name} was moved to.`,
    );
  }
  return worktrees;
}

export async function repairWorktrees(git: AsyncGitRunner, root: string, worktrees: readonly string[]): Promise<void> {
  if (worktrees.length === 0) return;
  const repaired = await git(root, ["worktree", "repair", ...worktrees], { timeoutMs: 30_000 });
  if (repaired.status !== 0) {
    throw new EngineStateError("conflict", `git could not re-link this project's worktrees to the new folder: ${(repaired.stderr || repaired.stdout).trim() || `exit ${repaired.status}`}`);
  }
}
