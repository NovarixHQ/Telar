import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, PluginManifest } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../src/daemon";
import { stubModels } from "../../test/stub-models";
import { latexPlugin } from ".";
import { texFromWords } from "./composer";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const env = { allow: process.env.TELAR_ALLOW_CLI, textgen: process.env.TELAR_TEXTGEN };
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-latex-tex-"));
  roots.push(directory);
  return directory;
};
beforeAll(() => {
  process.env.TELAR_ALLOW_CLI = "1";
  delete process.env.TELAR_TEXTGEN;
});
afterAll(() => {
  for (const [name, value] of [["TELAR_ALLOW_CLI", env.allow], ["TELAR_TEXTGEN", env.textgen]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fakeClaude(record: string): string {
  const file = path.join(root(), "claude");
  const answer = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "```latex\n$$\\int_0^1 x^2\\,dx$$\n```", total_cost_usd: 0.0003, usage: { input_tokens: 60, output_tokens: 12 }, modelUsage: { "claude-haiku-4-5": {} } });
  fs.writeFileSync(`${file}.json`, answer);
  fs.writeFileSync(file, `#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.270 (fake)" && exit 0\nprintf '%s\\n' "$@" > "${record}"\ncat >> "${record}"\ncat "${file}.json"\n`, { mode: 0o755 });
  return file;
}

async function call(daemon: EngineDaemon, pathname: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${daemon.discovery.port}${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { text?: string; error?: { message: string } } };
}

test("the manifest's composer contribution is valid and reaches clients", async () => {
  expect(PluginManifest.parse(latexPlugin.manifest).composer?.commands.map((command) => command.name)).toEqual(["tex"]);
  const engineRoot = root();
  const daemon = await startEngine({ models: stubModels, engineRoot, pluginsDir: root() });
  daemons.push(daemon);
  const latex = (await new EngineClient(daemon.discovery).machinePlugins()).plugins.find((status) => status.meta.id === "latex");
  expect(latex?.meta.composer?.decorations.map((decoration) => [decoration.id, decoration.preview])).toEqual([
    ["display-math", { renderer: "katex" }],
    ["inline-math", { renderer: "katex" }],
  ]);
});

test("/tex turns words into LaTeX through the engine's one-shot completion, and counts what it cost", async () => {
  const engineRoot = root();
  const record = path.join(root(), "argv");
  const daemon = await startEngine({ models: stubModels, engineRoot, pluginsDir: root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.saveProviderInstance({ id: "claude", driver: "claude", binaryPath: fakeClaude(record) });
  const checkout = root();
  fs.mkdirSync(path.join(checkout, ".git"));
  await client.registerProject({ id: "project_one", name: "One", root: checkout });
  await client.createSession({ id: "session_one", projectId: "project_one" });

  const off = await call(daemon, "/v2/sessions/session_one/plugins/latex/tex", { text: "the integral of x squared from 0 to 1" });
  expect(off.body.error?.message).toContain("not enabled");

  await client.updateProject("project_one", { plugins: { latex: { enabled: true } } });
  const on = await call(daemon, "/v2/sessions/session_one/plugins/latex/tex", { text: "the integral of x squared from 0 to 1" });
  expect(on).toEqual({ status: 200, body: { text: "$$\\int_0^1 x^2\\,dx$$" } });

  const argv = fs.readFileSync(record, "utf8").split("\n");
  expect(argv.slice(argv.indexOf("--model"), argv.indexOf("--model") + 2)).toEqual(["--model", "haiku"]);
  expect(argv[argv.indexOf("--tools") + 1]).toBe("");
  expect(argv).toContain("--no-session-persistence");
  expect(argv.at(-1)).toBe("the integral of x squared from 0 to 1");

  const ledger = fs.readFileSync(path.join(daemon.store.paths.usageOneShot), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(ledger).toEqual([
    { at: expect.any(Number), driver: "claude", model: "claude-haiku-4-5", source: "plugin:latex", tokens: { input: 60, output: 12, cacheRead: 0, cacheCreate: 0 }, costUsd: 0.0003 },
  ]);
});

test("/tex with nothing after it says what to type, without calling the model", async () => {
  let called = false;
  const host = { complete: async () => ((called = true), { text: "x" }) };
  expect(texFromWords(host, { text: "  " })).rejects.toThrow("say what to write after /tex");
  expect(called).toBe(false);
});
