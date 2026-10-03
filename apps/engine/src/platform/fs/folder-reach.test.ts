import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { folderFs, reachFolder, reachOfError, type FolderFs } from "./folder-reach";

const made: string[] = [];
const dir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-reach-"));
  made.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of made.splice(0)) {
    if (fs.existsSync(directory)) fs.chmodSync(directory, 0o755);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const failingWith = (code: string): FolderFs => ({ ...folderFs, peek: () => Promise.reject(Object.assign(new Error(code), { code })) });

test("each errno reads as what a person would call it", async () => {
  const folder = dir();
  expect(await reachFolder(folder, { fs: failingWith("ENOENT") })).toEqual({ reach: "missing" });
  expect(await reachFolder(folder, { fs: failingWith("ENOTDIR") })).toEqual({ reach: "not_folder" });
  expect(await reachFolder(folder, { fs: failingWith("EACCES") })).toEqual({ reach: "denied" });
  expect(await reachFolder(folder, { fs: failingWith("EPERM") })).toEqual({ reach: "denied" });
  expect(await reachFolder(folder, { fs: failingWith("EIO") })).toEqual({ reach: "failing", code: "EIO" });
  expect(reachOfError(new Error("no code"))).toEqual({ reach: "failing", code: "unknown error" });
});

test("a real folder is reachable; a removed one, a file and an unreadable one are not", async () => {
  const folder = dir();
  expect(await reachFolder(folder)).toEqual({ reach: "ok" });

  const file = path.join(folder, "file.txt");
  fs.writeFileSync(file, "x");
  expect(await reachFolder(file)).toEqual({ reach: "not_folder" });
  expect(await reachFolder(path.join(file, "below"))).toEqual({ reach: "not_folder" });

  const locked = dir();
  fs.chmodSync(locked, 0o000);
  expect(await reachFolder(locked)).toEqual({ reach: "denied" });

  const gone = dir();
  fs.rmSync(gone, { recursive: true });
  expect(await reachFolder(gone)).toEqual({ reach: "missing" });
});

test("a folder whose stat never returns answers unresponsive within the timeout", async () => {
  const hung: FolderFs = { ...folderFs, stat: () => new Promise(() => undefined) };
  expect(await reachFolder(dir(), { fs: hung, timeoutMs: 10 })).toEqual({ reach: "unresponsive" });
});
