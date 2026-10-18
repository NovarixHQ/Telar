import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverEngine } from "@telar/engine-client/node";
import { engineRootFor } from "@telar/engine/headless";
import { runCli } from "./cli";
import { runChecks } from "./doctor";
import { DEFAULT_PORT } from "./link";
import { pair } from "./pair";
import { serveOptions } from "./serve";

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};
const capture = () => {
  const lines: string[] = [];
  return { lines, io: { out: (line: string) => void lines.push(line), err: (line: string) => void lines.push(line) } };
};

let home: string;
let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
let network: string;

beforeAll(async () => {
  home = tempDir("telar-cli-home-");
  child = Bun.spawn(["bun", path.join(import.meta.dir, "main.ts"), "serve", "--home", home, "--port", "0"], {
    env: { ...process.env, HOME: tempDir("telar-cli-user-"), TELAR_HOME: "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  let output = "";
  for await (const chunk of child.stdout) {
    output += decoder.decode(chunk);
    const match = /Serving on (http:\/\/\S+)/.exec(output);
    if (match) {
      network = match[1]!;
      break;
    }
  }
});

afterAll(() => {
  child.kill();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("version prints the build version", async () => {
  const { lines, io } = capture();
  expect(await runCli(["version"], io)).toBe(0);
  expect(lines).toEqual(["0.0.0-dev"]);
});

test("serve defaults to a fixed port and rejects a bad one", () => {
  expect(serveOptions({}, "/h")).toEqual({ home: "/h", host: "127.0.0.1", port: DEFAULT_PORT, tailscaleServe: false });
  expect(() => serveOptions({ port: "70000" }, "/h")).toThrow("--port");
});

test("serve answers ping on loopback and on the network address", async () => {
  expect(network).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const discovery = await discoverEngine(engineRootFor(home));
  expect((await fetch(`http://127.0.0.1:${discovery.port}/v2/ping`, { headers: { authorization: `Bearer ${discovery.token}` } })).ok).toBe(true);
  expect((await fetch(`${network}/v2/ping`)).ok).toBe(true);
  expect((await fetch(`${network}/v2/remote`)).status).toBe(401);
});

test("pair prints a fragment-only link and returns when a device pairs", async () => {
  const { lines, io } = capture();
  const done = pair({ home, tailscale: false, name: "Kitchen iPad", pollMs: 25 }, io);
  let link: string | undefined;
  while (!(link = lines.join("\n").match(/Link: (\S+)/)?.[1])) await Bun.sleep(10);

  const url = new URL(link);
  expect(url.search).toBe("");
  expect(url.pathname).toBe("/pair");
  const code = new URLSearchParams(url.hash.slice(1)).get("token")!;
  expect(code).toMatch(/^\d{8}$/);

  const paired = await fetch(`${url.origin}/v2/remote/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: "Fake phone", identity: { kind: "phone" } }),
  });
  expect(paired.status).toBe(200);
  expect(await done).toBe(0);

  const text = lines.join("\n");
  expect(text).toContain("Paired Kitchen iPad.");
  expect(text).toContain(`${code.slice(0, 4)} ${code.slice(4)}`);
  const discovery = await discoverEngine(engineRootFor(home));
  expect(text).not.toContain(discovery.token);
  const state = (await (await fetch(`http://127.0.0.1:${discovery.port}/v2/remote`, { headers: { authorization: `Bearer ${discovery.token}` } })).json()) as { devices: { name: string }[] };
  expect(state.devices.map((device) => device.name)).toEqual(["Kitchen iPad"]);
});

test("doctor reports each check against the running engine", async () => {
  const bin = tempDir("telar-cli-bin-");
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n", { mode: 0o755 });
  const previous = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = bin;
  process.env.HOME = tempDir("telar-cli-user-");
  try {
    const checks = await runChecks(home);
    expect(checks.map((check) => check.name)).toEqual(["home", "engine", "network", "claude", "codex", "opencode", "cursor agent", "terminals", "tailscale"]);
    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
    expect(byName.engine?.level).toBe("ok");
    expect(byName.network?.level).toBe("ok");
    expect(byName.claude?.detail).toContain("found");
  } finally {
    process.env.PATH = previous.PATH;
    process.env.HOME = previous.HOME;
  }
});

test("doctor fails when no engine runs, and bad usage exits 2", async () => {
  const { lines, io } = capture();
  expect(await runCli(["doctor", "--home", tempDir("telar-cli-empty-")], io)).toBe(1);
  expect(lines.join("\n")).toContain("fail  engine — not running");
  expect(await runCli(["bogus"], capture().io)).toBe(2);
  expect(await runCli(["pair", "--home", tempDir("telar-cli-empty-")], capture().io)).toBe(2);
});

test("SIGTERM stops serve cleanly and removes its files", async () => {
  child.kill("SIGTERM");
  expect(await child.exited).toBe(0);
  expect(fs.existsSync(path.join(engineRootFor(home), "engine.json"))).toBe(false);
  expect(fs.existsSync(path.join(engineRootFor(home), "serve.json"))).toBe(false);
});
