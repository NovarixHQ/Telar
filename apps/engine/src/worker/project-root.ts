import fs from "node:fs";
import { reachFolder, type FolderFs, type FolderReach } from "../platform/fs/folder-reach";
import { probeVolume } from "../platform/fs/volume-gate";
import { mountPointForRoot, statAsyncOf, type VolumeDeps } from "../platform/fs/volumes";

/** Present exactly when the session's cwd is a worktree rather than the project's checkout. */
type WorktreeFacts = { branch: string; repoRoot: string };

export type FolderCheck = { volumes?: VolumeDeps; fs?: FolderFs; timeoutMs?: number };

/** The turn's folder can't be worked in; the message says why in words a person can act on. */
export class WorkspaceUnreachableError extends Error {}

function missingWorktreeMessage(cwd: string, worktree: WorktreeFacts, exists: (path: string) => boolean): string {
  const project = exists(worktree.repoRoot)
    ? `The project itself is fine — it is still at ${worktree.repoRoot}, so do NOT re-register it; that would give it a new id and leave this session's history behind.`
    : `The project's own checkout at ${worktree.repoRoot} is missing too, so this is a larger loss than one worktree — check that path before anything else.`;
  return [
    `This session's worktree ${cwd} no longer exists.`,
    project,
    "A worktree goes when its session is archived or deleted, or when something outside Telar removes it — `gh pr merge --delete-branch` runs `git worktree remove` on whichever worktree holds the branch it is deleting, which takes the directory, the local branch and git's registration together.",
    `This session cannot continue in a checkout that is not there. Anything it had committed is on ${worktree.branch} if that branch survives (\`git branch -a --contains\`) and in the branch it was merged into either way; anything uncommitted went with the directory. Start a session on the project from whichever of those still exists.`,
  ].join(" ");
}

function reachMessage(cwd: string, folder: Exclude<FolderReach, { reach: "ok" }>, worktree?: WorktreeFacts): string {
  const lead = `This session's folder isn't reachable: ${cwd}.`;
  switch (folder.reach) {
    case "missing":
      if (worktree) return missingWorktreeMessage(cwd, worktree, (target) => fs.existsSync(target));
      return `${lead} The folder no longer exists; it may have been moved or deleted. Restore it, or re-register the project with its current location, and retry.`;
    case "not_folder":
      return `${lead} That path is not a folder any more.`;
    case "denied":
      return `${lead} Permission was denied by macOS or a security tool. Allow access to the folder or its drive, then retry.`;
    case "unresponsive":
      return `${lead} The drive isn't responding; it may be disconnected or blocked by security software.`;
    case "failing":
      return `${lead} The drive reported ${folder.code}; it may be disconnected or blocked by security software.`;
  }
}

/** Why a provider can't work in `cwd`, or undefined when it can. Bounded, so a hung drive answers too. */
export async function unreachableReason(cwd: string, worktree?: WorktreeFacts, check: FolderCheck = {}): Promise<string | undefined> {
  const volumes = check.volumes ?? {};
  // macOS leaves an empty `/Volumes/<name>` behind, which passes every folder check.
  const mount = mountPointForRoot(cwd, volumes);
  const [drive, folder] = await Promise.all([
    mount === undefined ? undefined : probeVolume(mount, statAsyncOf(volumes)),
    reachFolder(cwd, { ...(check.fs ? { fs: check.fs } : {}), ...(check.timeoutMs === undefined ? {} : { timeoutMs: check.timeoutMs }) }),
  ]);
  if (drive === "missing") {
    return `This session's folder isn't reachable: ${cwd}. The drive holding it (${mount}) is not connected. Plug it back in and retry — do not re-register the project from another path, which would give it a new id and leave this session's history behind.`;
  }
  if (folder.reach !== "ok") return reachMessage(cwd, folder, worktree);
  if (drive === "slow") return reachMessage(cwd, { reach: "unresponsive" }, worktree);
  return undefined;
}

export async function assertProjectRoot(cwd: string, worktree?: WorktreeFacts, check: FolderCheck = {}): Promise<void> {
  const reason = await unreachableReason(cwd, worktree, check);
  if (reason !== undefined) throw new WorkspaceUnreachableError(reason);
}
