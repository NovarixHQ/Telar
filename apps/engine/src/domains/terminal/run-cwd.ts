import fs from "node:fs";
import path from "node:path";
import type { StartRunInput } from "./live-run";
import { RunError } from "./types";

export function resolveRunCwd(input: Pick<StartRunInput, "worktreePath" | "config">): string {
  if (!path.isAbsolute(input.worktreePath)) {
    throw new RunError("invalid_request", "a run needs the absolute path of the worktree it launches from");
  }
  const root = path.resolve(input.worktreePath);
  const cwd = path.resolve(root, input.config.cwd ?? ".");
  if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) {
    throw new RunError("invalid_request", `the working directory "${input.config.cwd}" resolves outside the worktree`);
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new RunError("invalid_request", `there is no directory "${input.config.cwd ?? "."}" in ${root}`);
  }
  if (!stat.isDirectory()) throw new RunError("invalid_request", `"${input.config.cwd}" is not a directory`);

  let realRoot: string;
  let realCwd: string;
  try {
    realRoot = fs.realpathSync(root);
    realCwd = fs.realpathSync(cwd);
  } catch {
    throw new RunError("invalid_request", `the working directory "${input.config.cwd ?? "."}" could not be resolved inside ${root}`);
  }
  if (realCwd !== realRoot && !realCwd.startsWith(`${realRoot}${path.sep}`)) {
    throw new RunError("invalid_request", `the working directory "${input.config.cwd}" is a link out of the worktree: it really points at ${realCwd}`);
  }
  return cwd;
}
