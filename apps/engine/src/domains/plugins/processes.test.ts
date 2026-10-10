import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModuleProcesses } from "./processes";

const roots: string[] = [];
const owned: ModuleProcesses[] = [];
const dir = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-processes-"));
  roots.push(directory);
  return directory;
};
const host = (directory: string) => {
  const processes = new ModuleProcesses(directory, () => 7);
  owned.push(processes);
  return processes;
};
afterEach(async () => {
  for (const processes of owned.splice(0)) await processes.stopAll();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const exited = (pid: number) =>
  new Promise<void>((resolve) => {
    const check = () => (alive(pid) ? setImmediate(check) : resolve());
    check();
  });

test("a started child is listed, recorded on disk, and stopping it removes both", async () => {
  const directory = dir();
  const processes = host(directory);
  const child = processes.start("session_one", { command: "sleep", args: ["30"], cwd: directory });
  expect(processes.list()).toEqual([{ key: "session_one", pid: child.pid!, startedAt: 7, alive: true }]);
  expect(JSON.parse(fs.readFileSync(path.join(directory, "session_one.json"), "utf8")).pid).toBe(child.pid);
  expect(() => processes.start("session_one", { command: "sleep", args: ["30"], cwd: directory })).toThrow("already running");

  await processes.stop("session_one");
  expect(processes.list()).toEqual([]);
  expect(fs.existsSync(path.join(directory, "session_one.json"))).toBe(false);
  expect(alive(child.pid!)).toBe(false);
});

test("an adopted grandchild dies with its parent", async () => {
  const directory = dir();
  const processes = host(directory);
  processes.start("session_one", { command: "sleep", args: ["30"], cwd: directory });
  const grandchild = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  processes.adopt("session_one", grandchild.pid!);
  await processes.stop("session_one");
  await exited(grandchild.pid!);
});

test("restart starts the same command again under the same key", async () => {
  const directory = dir();
  const processes = host(directory);
  const first = processes.start("session_one", { command: "sleep", args: ["30"], cwd: directory });
  const second = await processes.restart("session_one");
  expect(second.pid).not.toBe(first.pid);
  expect(processes.list()).toEqual([expect.objectContaining({ key: "session_one", pid: second.pid!, alive: true })]);
});

test("the next host reaps what a crashed engine left, and a stopped host refuses new children", async () => {
  const directory = dir();
  const orphan = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  fs.writeFileSync(path.join(directory, "session_one.json"), JSON.stringify({ pid: orphan.pid, adopted: [] }));
  const processes = host(directory);
  await exited(orphan.pid!);
  expect(fs.readdirSync(directory)).toEqual([]);

  await processes.stopAll();
  expect(() => processes.start("session_two", { command: "sleep", args: ["30"], cwd: directory })).toThrow("shutting down");
});
