import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAsyncGitRunner } from "../../platform/git/runner";
import { listWorkspaceFilesAsync } from "./workspace";

const root = mkdtempSync(path.join(tmpdir(), "telar-submodules-"));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "protocol.file.allow=always", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    stdio: "pipe",
  });

function repo(name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

let project: string;
beforeAll(() => {
  const deep = repo("deep", { "deep.txt": "d" });
  const lib = repo("lib", { "src/lib.ts": "x", "README.md": "r" });
  git(lib, "submodule", "add", "-q", deep, "vendor/deep");
  git(lib, "commit", "-qm", "nest");
  const docs = repo("docs", { "guide.md": "g" });
  project = repo("project", { "main.ts": "m" });
  git(project, "submodule", "add", "-q", lib, "libs/lib");
  git(project, "submodule", "add", "-q", docs, "docs");
  git(project, "commit", "-qm", "subs");
  git(project, "submodule", "update", "--init", "--recursive", "-q");
  git(project, "submodule", "deinit", "-q", "docs");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("listing a project with submodules", () => {
  test("an initialised submodule lists its own files, nested ones included; none is listed as a file", async () => {
    const listing = await listWorkspaceFilesAsync(createAsyncGitRunner(), { cwd: project, now: 1 });
    expect(listing.files).toEqual([
      ".gitmodules",
      "libs/lib/.gitmodules",
      "libs/lib/README.md",
      "libs/lib/src/lib.ts",
      "libs/lib/vendor/deep/deep.txt",
      "main.ts",
    ]);
    expect(listing.submodules).toEqual(["docs", "libs/lib", "libs/lib/vendor/deep"]);
  });

  test("a project without submodules carries no submodule list", async () => {
    const listing = await listWorkspaceFilesAsync(createAsyncGitRunner(), { cwd: path.join(root, "docs"), now: 1 });
    expect(listing.files).toEqual(["guide.md"]);
    expect(listing.submodules).toBeUndefined();
  });

  test("an untracked nested repository is a folder, not a file", async () => {
    repo("project/scratch", { "notes.md": "n" });
    const listing = await listWorkspaceFilesAsync(createAsyncGitRunner(), { cwd: project, now: 1 });
    expect(listing.files).toContain("scratch/notes.md");
    expect(listing.files).not.toContain("scratch/");
    expect(listing.submodules).toContain("scratch");
    rmSync(path.join(project, "scratch"), { recursive: true, force: true });
  });
});
