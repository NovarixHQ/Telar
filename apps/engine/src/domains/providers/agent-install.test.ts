import { afterEach, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RegistryAgent } from "./agent-catalog";
import { installAgent, type InstallRunner } from "./agent-install";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const scratch = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-agents-"));
  roots.push(root);
  return root;
};

const BYTES = Buffer.from("#!/bin/sh\necho agent\n");
const SHA = crypto.createHash("sha256").update(BYTES).digest("hex");
const serve = (async () => new Response(BYTES)) as unknown as typeof fetch;
const agent = (distribution: RegistryAgent["distribution"]): RegistryAgent => ({ id: "sample", name: "Sample", version: "1.2.3", description: "", distribution });

test("a binary is downloaded, checked against its sha256 and made executable", async () => {
  const root = scratch();
  const installed = await installAgent(root, agent({ binary: { "darwin-aarch64": { archive: "https://example.test/sample", cmd: "./sample", sha256: SHA, args: ["--acp"] } } }), {
    fetch: serve,
    target: "darwin-aarch64",
  });
  expect(installed).toEqual({ command: path.join(root, "sample", "1.2.3", "sample"), args: ["--acp"], env: {} });
  expect(fs.statSync(installed.command).mode & 0o111).not.toBe(0);
});

test("a download that does not match its sha256 leaves nothing behind", async () => {
  const root = scratch();
  const wrong = agent({ binary: { "darwin-aarch64": { archive: "https://example.test/sample", cmd: "sample", sha256: "0".repeat(64) } } });
  await expect(installAgent(root, wrong, { fetch: serve, target: "darwin-aarch64" })).rejects.toThrow("sha256");
  expect(fs.existsSync(path.join(root, "sample", "1.2.3"))).toBeFalse();
});

test("a command that climbs out of its install is refused", async () => {
  const escape = agent({ binary: { "darwin-aarch64": { archive: "https://example.test/sample", cmd: "../../evil" } } });
  await expect(installAgent(scratch(), escape, { fetch: serve, target: "darwin-aarch64" })).rejects.toThrow("outside the install");
});

test("an npm package is installed with Bun into the agent's own folder", async () => {
  const root = scratch();
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const run: InstallRunner = async (command, args, { cwd }) => {
    calls.push({ command, args, cwd });
    const pkg = path.join(cwd, "node_modules", "@example", "acp");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ bin: { "example-acp": "cli.js" } }));
  };
  const installed = await installAgent(root, agent({ npx: { package: "@example/acp@1.2.3", args: ["--acp"] } }), { run, which: (name) => (name === "bun" ? "/bin/bun" : undefined), target: "darwin-aarch64" });
  expect(calls).toEqual([{ command: "/bin/bun", args: ["add", "--exact", "@example/acp@1.2.3"], cwd: path.join(root, "sample", "1.2.3") }]);
  expect(installed.command).toBe(path.join(root, "sample", "1.2.3", "node_modules", ".bin", "example-acp"));
});

test("a uv package is installed into the agent's folder, and an install already there is reused", async () => {
  const root = scratch();
  let runs = 0;
  const run: InstallRunner = async (_command, _args, { env }) => {
    runs++;
    fs.mkdirSync(env!.UV_TOOL_BIN_DIR!, { recursive: true });
    fs.writeFileSync(path.join(env!.UV_TOOL_BIN_DIR!, "fast-agent"), "");
  };
  const deps = { run, which: () => "/bin/uv", target: "darwin-aarch64" };
  const first = await installAgent(root, agent({ uvx: { package: "fast-agent==1.2.3" } }), deps);
  const second = await installAgent(root, agent({ uvx: { package: "fast-agent==1.2.3" } }), deps);
  expect(first.command).toBe(path.join(root, "sample", "1.2.3", "bin", "fast-agent"));
  expect(second).toEqual(first);
  expect(runs).toBe(1);
});

test("a package agent says which tool is missing", async () => {
  await expect(installAgent(scratch(), agent({ npx: { package: "x" } }), { which: () => undefined })).rejects.toThrow("needs Bun");
});
