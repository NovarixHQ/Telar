import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runShippedScript, scriptArgv } from "./script";

const dirs: string[] = [];
const argv = process.argv;
afterEach(() => {
  process.argv = argv;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("a script named in the environment runs in this process, sees its own arguments, and leaves no trace for its children", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-script-"));
  dirs.push(dir);
  const script = path.join(dir, "script.cjs");
  fs.writeFileSync(script, "globalThis.__telarScriptArgv = process.argv.slice(1);");
  const env: NodeJS.ProcessEnv = { TELAR_RUN_SCRIPT: script };
  process.argv = ["telar", "telar", "install-deps", "chromium"];
  expect(runShippedScript(env, process.argv)).toBe(true);
  expect((globalThis as { __telarScriptArgv?: string[] }).__telarScriptArgv).toEqual([script, "install-deps", "chromium"]);
  expect(env.TELAR_RUN_SCRIPT).toBeUndefined();
});

test("a module forked from inside the executable's own node_modules runs with its arguments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-script-"));
  dirs.push(dir);
  const script = path.join(dir, "node_modules", "dep", "child.js");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "globalThis.__telarForkArgv = process.argv.slice(1);");
  const telar = path.join(dir, "telar");
  process.argv = [telar, telar, script, "--flag"];
  expect(runShippedScript({}, process.argv, true)).toBe(true);
  expect((globalThis as { __telarForkArgv?: string[] }).__telarForkArgv).toEqual([script, "--flag"]);
});

test("without the variable the process is the CLI, even when its first argument is a script elsewhere", () => {
  expect(runShippedScript({}, ["/opt/telar/telar", "/opt/telar/telar", "serve"], true)).toBe(false);
  expect(runShippedScript({}, ["/opt/telar/telar", "/opt/telar/telar", "/tmp/evil.js"], true)).toBe(false);
  expect(runShippedScript({}, ["/opt/telar/telar", "/opt/telar/telar", "/opt/telar/node_modules/dep/child.js"], false)).toBe(false);
});

test("outside a single executable a script runs under a Node binary with its arguments after it", () => {
  const [command, ...rest] = scriptArgv("/x/cli.js", ["--flag"]);
  expect(command).toMatch(/(node|bun)(\.exe)?$/);
  expect(rest).toEqual(["/x/cli.js", "--flag"]);
});
