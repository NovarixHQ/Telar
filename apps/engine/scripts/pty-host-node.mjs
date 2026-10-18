#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(engine, "scripts", ".pty-probe.bundle.mjs");

let failed = false;
try {
  execFileSync("bun", ["build", "scripts/pty-probe.ts", "--target=node", "--format=esm", "--external", "node-pty", "--outfile", bundle], {
    cwd: engine,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const printed = execFileSync(process.execPath, [bundle], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  process.stdout.write(printed);
  failed = !/PTY_HOST_OK (\d+)\/\1\b/.test(printed);
} catch (error) {
  process.stdout.write(error.stdout?.toString() ?? "");
  failed = true;
} finally {
  fs.rmSync(bundle, { force: true });
}

process.exit(failed ? 1 : 0);
