import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFile, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const installer = path.join(import.meta.dir, "install.sh");
const target = `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`;
const dirs = [];
const temp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const files = new Map();
let server;

function publish(version, { corrupt = false } = {}) {
  const stage = temp("telar-install-stage-");
  fs.writeFileSync(path.join(stage, "telar"), `#!/bin/sh\necho "telar ${version}"\n`, { mode: 0o755 });
  const archive = `telar-${version}-${target}.tar.gz`;
  const out = path.join(temp("telar-install-out-"), archive);
  expect(spawnSync("tar", ["-czf", out, "-C", stage, "."]).status).toBe(0);
  const bytes = fs.readFileSync(out);
  const hash = crypto.createHash("sha256").update(corrupt ? "other" : bytes).digest("hex");
  files.set(`/${version}/${archive}`, bytes);
  files.set(`/${version}/${archive}.sha256`, `${hash}  ${archive}\n`);
}

beforeAll(() => {
  publish("1.2.3");
  publish("1.3.0-nightly.7");
  publish("9.9.9", { corrupt: true });
  files.set("/stable", "1.2.3\n");
  files.set("/nightly", "1.3.0-nightly.7\n");
  server = Bun.serve({ port: 0, fetch: (request) => (files.has(new URL(request.url).pathname) ? new Response(files.get(new URL(request.url).pathname)) : new Response("missing", { status: 404 })) });
});

afterAll(() => {
  server.stop(true);
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Async: the file server lives in this process, so a blocking spawn would starve it.
const sh = (args, home) =>
  new Promise((resolve) => execFile("sh", [installer, ...args], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" }, (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr })));

async function install(...args) {
  const home = temp("telar-install-home-");
  return { home, run: await sh(["--base", `http://127.0.0.1:${server.port}`, ...args], home) };
}

test("installs the stable channel and links telar", async () => {
  const { home, run } = await install();
  expect(run.status).toBe(0);
  const link = path.join(home, ".local/bin/telar");
  expect(spawnSync(link, { encoding: "utf8" }).stdout).toBe("telar 1.2.3\n");
  expect(fs.readlinkSync(path.join(home, ".telar/runtime/current"))).toBe("versions/1.2.3");
});

test("the nightly channel resolves its own version", async () => {
  const { home, run } = await install("--channel", "nightly");
  expect(run.status).toBe(0);
  expect(spawnSync(path.join(home, ".local/bin/telar"), { encoding: "utf8" }).stdout).toBe("telar 1.3.0-nightly.7\n");
});

test("an explicit version skips the channel lookup", async () => {
  const { home, run } = await install("--version", "1.2.3");
  expect(run.status).toBe(0);
  expect(fs.existsSync(path.join(home, ".telar/runtime/versions/1.2.3/telar"))).toBe(true);
});

test("a checksum mismatch installs nothing", async () => {
  const { home, run } = await install("--version", "9.9.9");
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("checksum mismatch");
  expect(fs.existsSync(path.join(home, ".local/bin/telar"))).toBe(false);
  expect(fs.existsSync(path.join(home, ".telar/runtime/versions/9.9.9"))).toBe(false);
});

test("the placeholder host is refused with a clear message", async () => {
  const run = await sh([], temp("telar-install-home-"));
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("no download host is configured");
});
