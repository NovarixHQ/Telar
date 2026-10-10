import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../../daemon";
import { ECHO_MANIFEST, writePlugin } from "../../../../test/fixtures/external-plugin";
import { stubModels } from "../../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const env = { allow: process.env.TELAR_ALLOW_CLI, textgen: process.env.TELAR_TEXTGEN };
const tempDir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-plugin-complete-"));
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

function fakeClaude(): string {
  const file = path.join(tempDir(), "claude");
  const answer = { type: "result", subtype: "success", is_error: false, result: "x^2", total_cost_usd: 0.0001, usage: { input_tokens: 20, output_tokens: 3 }, modelUsage: { "claude-haiku-4-5": {} } };
  fs.writeFileSync(`${file}.json`, JSON.stringify(answer));
  fs.writeFileSync(file, `#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.270 (fake)" && exit 0\ncat > /dev/null\ncat "${file}.json"\n`, { mode: 0o755 });
  return file;
}

test("an installed plugin asks the engine for a one-shot completion over its own channel, bounded and counted like a module's", async () => {
  const pluginsDir = tempDir();
  writePlugin(pluginsDir, "echo", { ...ECHO_MANIFEST, routes: { session: ["status", "ask"] } });
  const daemon = await startEngine({ models: stubModels, engineRoot: tempDir(), pluginsDir });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.saveProviderInstance({ id: "claude", driver: "claude", binaryPath: fakeClaude() });
  await client.registerProject({ id: "project_one", name: "One", root: tempDir() });
  await client.createSession({ id: "session_one", projectId: "project_one" });
  await client.updateProject("project_one", { plugins: { echo: { enabled: true } } });

  await expect(client.plugin("session_one", "echo", "ask", { prompt: "x squared" })).resolves.toEqual({ text: "x^2" });
  await expect(client.plugin("session_one", "echo", "ask", { prompt: "a".repeat(8_001) })).rejects.toThrow("prompt passed 8000 characters");
  await expect(client.plugin("session_one", "echo", "ask", { prompt: "x", maxChars: 1 })).rejects.toThrow("answer passed 1 characters");
  await expect(client.plugin("session_one", "echo", "ask", {})).rejects.toThrow("needs a prompt");

  const ledger = fs.readFileSync(daemon.store.paths.usageOneShot, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(ledger.map((entry) => [entry.source, entry.model, entry.tokens.input])).toEqual([
    ["plugin:echo", "claude-haiku-4-5", 20],
    ["plugin:echo", "claude-haiku-4-5", 20],
  ]);
});
