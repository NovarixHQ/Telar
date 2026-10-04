import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { interactiveShell, resolveShell, splitMarkers, typedCommand } from "./shell";
import { RunStore } from "./store";
import { redactConfiguration, type RunConfiguration } from "./types";

const tempDirs: string[] = [];

const track = (dir: string): string => (tempDirs.push(dir), dir);
const worktree = () => track(fs.mkdtempSync(path.join(os.tmpdir(), "telar-run-shape-tree-")));
const storeDir = () => track(fs.mkdtempSync(path.join(os.tmpdir(), "telar-run-shape-store-")));

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function config(command: string, extra: Partial<RunConfiguration> = {}): RunConfiguration {
  return { id: "runcfg_test", projectId: "proj_1", name: "fixture", command, createdAt: 1, updatedAt: 1, ...extra };
}

test("a one-shot command resolves to this platform's own shell, with the command last and nothing split", () => {
  const posix = resolveShell({ command: "bun run dev && echo done" }, "darwin", {});
  expect(posix.file).toBe("/bin/sh");
  expect(posix.args).toEqual(["-c", "bun run dev && echo done"]);
  expect(posix.windowsVerbatimArguments).toBe(false);
});

test("on win32 a one-shot command goes to ComSpec, quoted the way cmd.exe expects and verbatim", () => {
  const spec = resolveShell({ command: "bun run dev && echo done" }, "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" });
  expect(spec.args).toEqual(["/d", "/s", "/c", '"bun run dev && echo done"']);
  expect(spec.windowsVerbatimArguments).toBe(true);
  expect(resolveShell({ command: "x" }, "win32", {}).file).toBe("cmd.exe");
});

test("a terminal holds the person's login shell, with hooks for the shells that can report", () => {
  const dir = worktree();
  const zsh = interactiveShell({ pty: true, platform: "darwin", env: { SHELL: "/bin/zsh", ZDOTDIR: "/Users/me/.config/zsh" }, integrationDir: dir });
  expect([zsh.file, zsh.args, zsh.integrated]).toEqual(["/bin/zsh", ["-l", "-i"], true]);
  expect(zsh.env.TELAR_USER_ZDOTDIR).toBe("/Users/me/.config/zsh");
  expect(fs.readFileSync(path.join(zsh.env.ZDOTDIR!, ".zshrc"), "utf8")).toContain("133;D");

  const bash = interactiveShell({ pty: true, platform: "linux", env: { SHELL: "/usr/bin/bash" }, integrationDir: dir });
  expect(bash.args[0]).toBe("--init-file");
  expect(bash.integrated).toBe(true);

  const fish = interactiveShell({ pty: true, platform: "darwin", env: { SHELL: "/opt/homebrew/bin/fish" }, integrationDir: dir });
  expect(fish.args.slice(0, 3)).toEqual(["-l", "-i", "--init-command"]);

  const dash = interactiveShell({ pty: true, platform: "linux", env: { SHELL: "/bin/dash" }, integrationDir: dir });
  expect([dash.args, dash.integrated]).toEqual([["-l"], false]);

  expect(interactiveShell({ pty: true, platform: "darwin", env: {}, integrationDir: dir }).file).toBe("/bin/zsh");
  expect(interactiveShell({ program: "/bin/bash", pty: true, platform: "darwin", env: { SHELL: "/bin/zsh" }, integrationDir: dir }).file).toBe("/bin/bash");
});

test("without a terminal the shell reads commands from its stdin, and each is followed by a sentinel", () => {
  const shell = interactiveShell({ pty: false, platform: "darwin", env: { SHELL: "/bin/zsh" }, integrationDir: worktree() });
  expect([shell.file, shell.args, shell.integrated]).toEqual(["/bin/sh", [], false]);
  expect(typedCommand("bun test", shell, false)).toBe("bun test\nprintf '\\033]133;D;%s\\007' \"$?\"\n");
  expect(typedCommand("bun test", { kind: "zsh", integrated: true }, true)).toBe("bun test\r");
  expect(typedCommand("a\nb", { kind: "zsh", integrated: true }, true)).toBe("\x1b[200~a\nb\x1b[201~\r");
});

test("the marks a shell prints are split from its text, with the finished command's exit code", () => {
  expect(splitMarkers("out\r\n\x1b]133;D;3\x07\x1b]133;A\x07% ")).toEqual(["out\r\n", { kind: "done", exitCode: 3 }, { kind: "prompt" }, "% "]);
  expect(splitMarkers("\x1b]133;C\x1b\\")).toEqual([{ kind: "busy" }]);
  expect(splitMarkers("\x1b]133;D\x07")).toEqual([{ kind: "done" }]);
  expect(splitMarkers("plain")).toEqual(["plain"]);
});

async function hooked(program: string, typed: string): Promise<string> {
  const home = worktree();
  const shell = interactiveShell({ pty: true, platform: process.platform, env: { SHELL: program }, integrationDir: worktree() });
  const child = Bun.spawn([shell.file, ...shell.args], {
    cwd: home,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TERM: "dumb", ...shell.env },
    stdin: new TextEncoder().encode(typed),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;
  return out + err;
}

for (const program of ["/bin/zsh", "/bin/bash"]) {
  test.skipIf(!fs.existsSync(program))(`${path.basename(program)}'s hooks mark each prompt and the exit code of each finished command`, async () => {
    const out = await hooked(program, "false\ntrue\nexit\n");
    expect(out).toContain("\x1b]133;A\x07");
    expect(out).toContain("\x1b]133;D;1\x07");
    expect(out).toContain("\x1b]133;D;0\x07");
  }, 15_000);
}

test("a recipe saved with shell arguments still reads, and its program becomes the terminal's shell", () => {
  const dir = storeDir();
  const old = {
    configurations: [
      { id: "runcfg_old", projectId: "proj_1", name: "web dev", command: "echo ok", shell: { program: "/bin/bash", args: ["-lc"] }, createdAt: 1, updatedAt: 1 },
      { id: "runcfg_older", projectId: "proj_1", name: "api", command: "echo legacy", createdAt: 1, updatedAt: 1 },
    ],
  };
  fs.writeFileSync(path.join(dir, "proj_1.json"), JSON.stringify(old));

  const store = new RunStore(dir);
  expect(store.get("proj_1", "runcfg_old").shell).toEqual({ program: "/bin/bash" });
  expect(store.get("proj_1", "runcfg_older").shell).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(path.join(dir, "proj_1.json"), "utf8"))).toEqual(old);
});

test("a pinned shell round-trips through the store, and a patch that does not mention it leaves it alone", () => {
  const store = new RunStore(storeDir());
  const created = store.create("proj_1", { name: "web dev", command: "bun run dev", shell: { program: "/bin/bash" } });
  const updated = store.update("proj_1", created.id, { name: "web dev", command: "bun run start", cwd: "apps/web" });
  expect(updated.shell).toEqual({ program: "/bin/bash" });
  expect(updated.command).toBe("bun run start");
});

test("a shell is not a hole in the redaction promise — a secret pasted into one is scrubbed like every other field", () => {
  const view = redactConfiguration(
    config("bun run dev", {
      shell: { program: "/opt/sk_live_abcdef/bash" },
      env: [{ key: "TOKEN", value: "sk_live_abcdef", secret: true }],
    }),
  );
  expect(view.shell).toEqual({ program: "/opt/«redacted»/bash" });
  expect(JSON.stringify(view)).not.toContain("sk_live_abcdef");
});

test("a store refuses a shell with no program rather than saving a recipe nothing can launch", () => {
  const store = new RunStore(storeDir());
  expect(() => store.create("proj_1", { name: "web", command: "bun run dev", shell: { program: "" } })).toThrow();
});
