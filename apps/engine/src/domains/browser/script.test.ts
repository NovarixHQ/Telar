import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScriptFromEnv, scriptArgv } from "./script";

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
  expect(runScriptFromEnv(env)).toBe(true);
  expect((globalThis as { __telarScriptArgv?: string[] }).__telarScriptArgv).toEqual([script, "install-deps", "chromium"]);
  expect(env.TELAR_RUN_SCRIPT).toBeUndefined();
});

test("without the variable the process is the CLI", () => {
  expect(runScriptFromEnv({})).toBe(false);
});

test("outside a single executable a script runs under a Node binary with its arguments after it", () => {
  const [command, ...rest] = scriptArgv("/x/cli.js", ["--flag"]);
  expect(command).toMatch(/(node|bun)(\.exe)?$/);
  expect(rest).toEqual(["/x/cli.js", "--flag"]);
});
