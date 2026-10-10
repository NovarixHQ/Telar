import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderDriverKind, UsageSnapshot } from "@telar/engine-client";
import { usageFrom } from "../../drivers/claude/usage";
import { requireCli } from "./cli";
import { withClaudeSettingsEnv } from "./claude-settings-env";

export type TextGenEffort = "low" | "medium" | "high";

export type TextGenDriverInput = {
  driver: ProviderDriverKind;
  binaryPath?: string;
  env?: Record<string, string | undefined>;
  model?: string;
  effort?: TextGenEffort;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type Structured = Record<string, unknown>;

export type TextAnswer = { text: string; model?: string; usage?: UsageSnapshot };

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_EFFORT: TextGenEffort = "low";
const SYSTEM_PROMPT = "Answer with the requested JSON only.";

export async function runStructured(input: TextGenDriverInput, prompt: string, schema: object): Promise<Structured | undefined> {
  try {
    return await runStructuredOrThrow(input, prompt, schema);
  } catch (error) {
    console.error(`[engine] ${input.driver} text generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export async function runStructuredOrThrow(input: TextGenDriverInput, prompt: string, schema: object): Promise<Structured | undefined> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "telar-textgen-"));
  try {
    if (input.driver === "claude") return await runClaude(input, scratch, prompt, schema);
    if (input.driver === "codex") return await runCodex(input, scratch, prompt, schema);
    return await runOpenCode(input, scratch, prompt, schema);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function runTextOrThrow(input: TextGenDriverInput, prompt: string, system: string): Promise<TextAnswer | undefined> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "telar-textgen-"));
  try {
    if (input.driver === "claude") return await runClaudeText(input, scratch, prompt, system);
    if (input.driver === "codex") return await runCodexText(input, scratch, `${system}\n\n${prompt}`);
    return await runOpenCodeText(input, scratch, prompt, system);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function claudeTextGenArgs(input: Pick<TextGenDriverInput, "model" | "effort">, schema: object | undefined, system = SYSTEM_PROMPT): string[] {
  return [
    "-p",
    "--no-session-persistence",
    "--output-format",
    "json",
    ...(schema ? ["--json-schema", JSON.stringify(schema)] : []),
    "--tools",
    "",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify({ disableAllHooks: true, alwaysThinkingEnabled: false }),
    "--permission-mode",
    "dontAsk",
    "--max-turns",
    "1",
    "--system-prompt",
    system,
    ...(input.model ? ["--model", input.model] : []),
    "--effort",
    input.effort ?? DEFAULT_EFFORT,
  ];
}

async function claudeAnswer(input: TextGenDriverInput, scratch: string, prompt: string, args: string[]): Promise<Structured | undefined> {
  const executable = requireCli("claude", input.binaryPath ? { binaryPath: input.binaryPath } : {});
  const env = withClaudeSettingsEnv(spawnEnv(input.env)) as NodeJS.ProcessEnv;
  const exit = await runToCompletion(executable, args, scratch, input, env, prompt);
  if (exit === undefined) return undefined;
  const answer = parseJson(exit.out);
  if (answer?.["is_error"] === true && typeof answer["result"] === "string") throw new TextGenFailure(redactedTail(answer["result"]));
  if (exit.code !== 0) throw exitFailure(exit);
  return answer ?? noAnswer(exit);
}

async function runClaude(input: TextGenDriverInput, scratch: string, prompt: string, schema: object): Promise<Structured | undefined> {
  const answer = await claudeAnswer(input, scratch, prompt, claudeTextGenArgs(input, schema));
  if (answer === undefined) return undefined;
  const structured = answer?.["structured_output"];
  if (typeof structured === "object" && structured !== null) return structured as Structured;
  throw new TextGenFailure(`no structured output (${String(answer?.["subtype"] ?? "unparsable answer")})`);
}

async function runClaudeText(input: TextGenDriverInput, scratch: string, prompt: string, system: string): Promise<TextAnswer | undefined> {
  const answer = await claudeAnswer(input, scratch, prompt, claudeTextGenArgs(input, undefined, system));
  if (answer === undefined) return undefined;
  if (typeof answer["result"] !== "string") throw new TextGenFailure(`no answer (${String(answer["subtype"] ?? "unparsable answer")})`);
  const usage = usageFrom(answer["usage"], answer["total_cost_usd"]);
  const model = Object.keys((answer["modelUsage"] as Structured | undefined) ?? {})[0] ?? input.model;
  return { text: answer["result"], ...(model ? { model } : {}), ...(usage ? { usage } : {}) };
}

function codexTextGenArgs(input: Pick<TextGenDriverInput, "model" | "effort">, schemaPath: string | undefined, outputPath: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-s",
    "read-only",
    ...(input.model ? ["--model", input.model] : []),
    "--config",
    `model_reasoning_effort="${input.effort ?? DEFAULT_EFFORT}"`,
    "--config",
    'web_search="disabled"',
    ...(schemaPath ? ["--output-schema", schemaPath] : []),
    "--output-last-message",
    outputPath,
    "-",
  ];
}

async function runCodex(input: TextGenDriverInput, scratch: string, prompt: string, schema: object): Promise<Structured | undefined> {
  const executable = requireCli("codex", input.binaryPath ? { binaryPath: input.binaryPath } : {});
  const schemaPath = path.join(scratch, "schema.json");
  const outputPath = path.join(scratch, "answer.json");
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  const work = path.join(scratch, "work");
  fs.mkdirSync(work);
  const exit = await runToCompletion(executable, codexTextGenArgs(input, schemaPath, outputPath), work, input, spawnEnv(input.env), prompt);
  if (exit === undefined) return undefined;
  if (exit.code !== 0) throw exitFailure(exit);
  return parseJson(readOrEmpty(outputPath)) ?? noAnswer(exit);
}

async function runCodexText(input: TextGenDriverInput, scratch: string, prompt: string): Promise<TextAnswer | undefined> {
  const executable = requireCli("codex", input.binaryPath ? { binaryPath: input.binaryPath } : {});
  const outputPath = path.join(scratch, "answer.txt");
  const work = path.join(scratch, "work");
  fs.mkdirSync(work);
  const exit = await runToCompletion(executable, codexTextGenArgs(input, undefined, outputPath), work, input, spawnEnv(input.env), prompt);
  if (exit === undefined) return undefined;
  if (exit.code !== 0) throw exitFailure(exit);
  const text = readOrEmpty(outputPath);
  return text ? { text, ...(input.model ? { model: input.model } : {}) } : noAnswer(exit);
}

function openCodeTextGenArgs(input: Pick<TextGenDriverInput, "model">): string[] {
  return ["run", "--format", "json", "--pure", ...(input.model ? ["--model", input.model] : [])];
}

function openCodeTextGenConfig(prompt: string): string {
  return JSON.stringify({
    permission: "deny",
    tools: { "*": false },
    share: "disabled",
    autoupdate: false,
    instructions: [],
    agent: { build: { prompt } },
  });
}

async function runOpenCode(input: TextGenDriverInput, scratch: string, prompt: string, schema: object): Promise<Structured | undefined> {
  const config = openCodeTextGenConfig(`${SYSTEM_PROMPT} It must match this JSON schema: ${JSON.stringify(schema)}`);
  const exit = await openCodeExit(input, scratch, prompt, config);
  if (exit === undefined) return undefined;
  return parseOpenCodeAnswer(exit.out) ?? noAnswer(exit);
}

async function runOpenCodeText(input: TextGenDriverInput, scratch: string, prompt: string, system: string): Promise<TextAnswer | undefined> {
  const exit = await openCodeExit(input, scratch, prompt, openCodeTextGenConfig(system));
  if (exit === undefined) return undefined;
  const text = openCodeText(exit.out);
  return text ? { text, ...(input.model ? { model: input.model } : {}) } : noAnswer(exit);
}

async function openCodeExit(input: TextGenDriverInput, scratch: string, prompt: string, config: string): Promise<Exit | undefined> {
  const executable = requireCli("opencode", input.binaryPath ? { binaryPath: input.binaryPath } : {});
  const env = spawnEnv({ ...input.env, OPENCODE_CONFIG_CONTENT: config, OPENCODE_DISABLE_PROJECT_CONFIG: "1" });
  const exit = await runToCompletion(executable, openCodeTextGenArgs(input), scratch, input, env, prompt);
  if (exit !== undefined && exit.code !== 0) throw exitFailure(exit);
  return exit;
}

function openCodeText(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => parseJson(line))
    .flatMap((event) => (event?.["type"] === "text" ? [(event["part"] as { text?: unknown } | undefined)?.text] : []))
    .filter((part): part is string => typeof part === "string")
    .join("");
}

function parseOpenCodeAnswer(stdout: string): Structured | undefined {
  const text = openCodeText(stdout);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? parseJson(text.slice(start, end + 1)) : undefined;
}

export class TextGenFailure extends Error {}

type Exit = { code: number | string; out: string; err: string };

function redactedTail(text: string, max = 300): string {
  return text.replace(/\b(sk-[\w-]+|[A-Za-z0-9_-]{32,})/g, "[redacted]").replace(/\s+/g, " ").trim().slice(-max);
}

function exitFailure(exit: Exit): TextGenFailure {
  return new TextGenFailure(`exited ${exit.code}: ${redactedTail(exit.err || exit.out) || "no output"}`);
}

function noAnswer(exit: Exit): never {
  throw new TextGenFailure(`no JSON answer${exit.err.trim() ? `: ${redactedTail(exit.err)}` : ""}`);
}

function runToCompletion(
  executable: string,
  args: string[],
  cwd: string,
  input: TextGenDriverInput,
  env: NodeJS.ProcessEnv,
  prompt: string,
): Promise<Exit | undefined> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      resolve(undefined);
      return;
    }
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (value: Exit | undefined, failure?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      input.signal?.removeEventListener("abort", onAbort);
      if (failure) reject(new TextGenFailure(failure));
      else resolve(value);
    };
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      finish(undefined, "timed out");
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(undefined);
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => finish(undefined, `could not start: ${error.message}`));
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.length <= MAX_STDOUT_BYTES) return;
      child.kill("SIGKILL");
      finish(undefined, `output passed ${MAX_STDOUT_BYTES / 1024 / 1024} MB`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString("utf8")).slice(-4000);
    });
    child.on("close", (code, signal) => finish({ code: code ?? signal ?? "unknown", out, err }));
    child.stdin.on("error", () => undefined);
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function spawnEnv(patch: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

function parseJson(text: string): Structured | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Structured) : undefined;
  } catch {
    return undefined;
  }
}

function readOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
