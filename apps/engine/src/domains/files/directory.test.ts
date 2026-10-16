import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAsyncGitRunner } from "../../platform/git/runner";
import { listWorkspaceDirectory, MAX_DIRECTORY_ENTRIES } from "./directory";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "telar-directory-")));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "protocol.file.allow=always", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "pipe" });
const runner = createAsyncGitRunner();

function write(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

const repo = path.join(scratch, "repo");
const plain = path.join(scratch, "plain");
const outside = path.join(scratch, "outside");

beforeAll(() => {
  write(repo, { "tracked.ts": "t", ".gitignore": "node_modules\n*.log\nbuild/\n", "src/index.ts": "i" });
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  write(repo, { "untracked.ts": "u", "debug.log": "l", "node_modules/dep/index.js": "d", "build/out/app.js": "a", ".env.local": "e", ".config/tool.json": "{}" });
  symlinkSync(".", path.join(repo, "loop"));
  symlinkSync("src", path.join(repo, "source"));
  symlinkSync("tracked.ts", path.join(repo, "alias.ts"));
  write(outside, { "secret.txt": "s" });
  symlinkSync(outside, path.join(repo, "escape"));
  symlinkSync("missing", path.join(repo, "broken"));
  const lib = path.join(scratch, "lib");
  write(lib, { "lib.ts": "x" });
  git(lib, "init", "-q");
  git(lib, "add", ".");
  git(lib, "commit", "-qm", "init");
  git(repo, "submodule", "add", "-q", lib, "vendor/lib");
  write(plain, { "notes.md": "n", ".hidden/inner.txt": "h", "empty/.keep": "" });
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const list = (root: string, dir: string) => listWorkspaceDirectory(runner, { root, dir, label: "session workspace" });

describe("listWorkspaceDirectory in a repository", () => {
  test("lists one level from disk: tracked, untracked, ignored, dotfiles and .git, with ignored ones marked", async () => {
    const listed = await list(repo, "");
    expect(listed.truncated).toBe(false);
    expect(listed.entries.map(({ name, kind, ignored }) => [name, kind, ignored ?? false])).toEqual([
      [".config", "directory", false],
      [".git", "directory", false],
      ["build", "directory", true],
      ["node_modules", "directory", true],
      ["source", "directory", false],
      ["src", "directory", false],
      ["vendor", "directory", false],
      [".env.local", "file", false],
      [".gitignore", "file", false],
      [".gitmodules", "file", false],
      ["alias.ts", "file", false],
      ["broken", "link", false],
      ["debug.log", "file", true],
      ["escape", "link", false],
      ["loop", "link", false],
      ["tracked.ts", "file", false],
      ["untracked.ts", "file", false],
    ]);
  });

  test("inside an ignored folder every entry is ignored, and nothing below is read until asked", async () => {
    const listed = await list(repo, "build");
    expect(listed.entries).toEqual([{ name: "out", path: "build/out", kind: "directory", ignored: true }]);
    expect((await list(repo, "build/out")).entries).toEqual([{ name: "app.js", path: "build/out/app.js", kind: "file", ignored: true }]);
  });

  test("symlinks are marked; a loop, a broken link and one leaving the root are not followable", async () => {
    const byName = new Map((await list(repo, "")).entries.map((entry) => [entry.name, entry]));
    expect(byName.get("source")).toEqual({ name: "source", path: "source", kind: "directory", symlink: true });
    expect(byName.get("alias.ts")).toEqual({ name: "alias.ts", path: "alias.ts", kind: "file", symlink: true });
    for (const name of ["loop", "escape", "broken"]) expect(byName.get(name)?.kind).toBe("link");
    expect((await list(repo, "source")).entries.map((entry) => entry.path)).toEqual(["source/index.ts"]);
  });

  test("a submodule is a marked folder that lists its own files", async () => {
    expect((await list(repo, "vendor")).entries).toEqual([{ name: "lib", path: "vendor/lib", kind: "directory", submodule: true }]);
    expect((await list(repo, "vendor/lib")).entries.map((entry) => entry.name)).toEqual([".git", "lib.ts"]);
  });

  test("refuses a path that leaves the root, lexically or through a symlink", async () => {
    await expect(list(repo, "..")).rejects.toThrow("outside the session workspace");
    await expect(list(repo, "escape")).rejects.toThrow("outside the session workspace");
    await expect(list(repo, "tracked.ts")).rejects.toThrow("not a directory");
    await expect(list(repo, "nowhere")).rejects.toThrow("no such directory");
  });
});

describe("listWorkspaceDirectory outside a repository", () => {
  test("lists everything, dotted folders included, and marks nothing ignored", async () => {
    const listed = await list(plain, "");
    expect(listed.entries).toEqual([
      { name: ".hidden", path: ".hidden", kind: "directory" },
      { name: "empty", path: "empty", kind: "directory" },
      { name: "notes.md", path: "notes.md", kind: "file" },
    ]);
  });

  test("caps a huge folder and says so", async () => {
    const huge = path.join(scratch, "huge");
    mkdirSync(huge);
    for (let index = 0; index <= MAX_DIRECTORY_ENTRIES; index += 1) writeFileSync(path.join(huge, `f${index}`), "");
    const listed = await list(huge, "");
    expect(listed.entries).toHaveLength(MAX_DIRECTORY_ENTRIES);
    expect(listed.truncated).toBe(true);
  });
});
