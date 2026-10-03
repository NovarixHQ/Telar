import fsp from "node:fs/promises";
import { constants } from "node:fs";

export type FolderReach =
  | { reach: "ok" }
  | { reach: "missing" | "not_folder" | "denied" | "unresponsive" }
  | { reach: "failing"; code: string };

export type FolderFs = {
  stat: (target: string) => Promise<{ isDirectory(): boolean }>;
  access: (target: string, mode: number) => Promise<void>;
  /** Opens the folder and reads one entry: a security tool can deny that while stat and access pass. */
  peek: (target: string) => Promise<void>;
};

export const FOLDER_REACH_TIMEOUT_MS = 3_000;

export const folderFs: FolderFs = {
  stat: (target) => fsp.stat(target),
  access: (target, mode) => fsp.access(target, mode),
  peek: async (target) => {
    const dir = await fsp.opendir(target);
    try {
      await dir.read();
    } finally {
      // Bun's `close()` returns nothing rather than a promise.
      await Promise.resolve()
        .then(() => dir.close())
        .catch(() => undefined);
    }
  },
};

export function reachOfError(error: unknown): FolderReach {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return { reach: "missing" };
  if (code === "ENOTDIR") return { reach: "not_folder" };
  if (code === "EACCES" || code === "EPERM") return { reach: "denied" };
  if (code === "ETIMEDOUT") return { reach: "unresponsive" };
  return { reach: "failing", code: code ?? "unknown error" };
}

export async function reachFolder(folder: string, options: { fs?: FolderFs; timeoutMs?: number } = {}): Promise<FolderReach> {
  const io = options.fs ?? folderFs;
  const check = async (): Promise<FolderReach> => {
    try {
      if (!(await io.stat(folder)).isDirectory()) return { reach: "not_folder" };
      await io.access(folder, constants.R_OK | constants.X_OK);
      await io.peek(folder);
      return { reach: "ok" };
    } catch (error) {
      return reachOfError(error);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<FolderReach>((resolve) => {
    timer = setTimeout(() => resolve({ reach: "unresponsive" }), options.timeoutMs ?? FOLDER_REACH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
