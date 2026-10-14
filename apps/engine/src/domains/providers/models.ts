import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Effort, ModelCatalogue, ProviderDriverKind, ProviderModel } from "@telar/engine-client";
import { refuseCliSpawnUnderTest, requireCli, resolveCliAsync } from "./cli";
import { AcpConnection } from "../../drivers/acp";
import { CodexAppServer, readCodexWindows, resolveCodexBinary, withCodexLongRows, type CodexWindow } from "../../drivers/codex";
import { agentEnv } from "../../platform/process/agent-env";

const MODEL_LIST_TIMEOUT_MS = 10_000;

const CLAUDE_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);

export function stripPricing(description: string): string {
  return description
    .split(" · ")
    .filter((clause) => !/\$\s*\d/.test(clause))
    .join(" · ")
    .trim();
}

type ClaudeModelInfo = {
  value?: unknown;
  resolvedModel?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportedEffortLevels?: unknown;
  supportsFastMode?: unknown;
};

type ClaudeModelQuery = {
  supportedModels(): Promise<unknown>;
  setModel?(model?: string): Promise<void>;
  getSettings?(): Promise<unknown>;
};
type ClaudeModelSdk = {
  query(input: { prompt: AsyncIterable<never>; options: Record<string, unknown> }): ClaudeModelQuery;
};

export function parseClaudeModels(payload: unknown): ProviderModel[] {
  if (!Array.isArray(payload)) return [];
  const rows = payload as ClaudeModelInfo[];
  const defaultRow = rows.find((row) => row.value === "default");
  const resolvesTo = typeof defaultRow?.resolvedModel === "string" ? defaultRow.resolvedModel : undefined;
  const covered = resolvesTo !== undefined && rows.some((row) => row.value !== "default" && row.resolvedModel === resolvesTo);

  return rows.flatMap((row) => {
    const id = typeof row.value === "string" ? row.value : "";
    if (!id) return [];
    if (id === "default" && covered) return [];
    const description = typeof row.description === "string" ? stripPricing(row.description) : "";
    const efforts = Array.isArray(row.supportedEffortLevels)
      ? row.supportedEffortLevels.filter((level): level is Effort => typeof level === "string" && CLAUDE_EFFORTS.has(level))
      : [];
    return [
      {
        id,
        label: typeof row.displayName === "string" && row.displayName ? row.displayName : id,
        ...(description ? { description } : {}),
        isDefault: id === "default" || (covered && row.resolvedModel === resolvesTo),
        hidden: false,
        hiddenByUser: false,
        legacy: false,
        source: "provider",
        efforts,
        ...(typeof row.resolvedModel === "string" && row.resolvedModel ? { resolves: row.resolvedModel } : {}),
        fastMode: row.supportsFastMode === true,
      },
    ];
  });
}

function defaultModelListExecutable(): string | undefined {
  try {
    return requireCli("claude", {});
  } catch {
    return undefined;
  }
}

export async function loadClaudeModelSdk(): Promise<ClaudeModelSdk> {
  refuseCliSpawnUnderTest("the Claude Agent SDK model probe");
  return (await import("@anthropic-ai/claude-agent-sdk")) as unknown as ClaudeModelSdk;
}

async function installedClaudeVersion(): Promise<string | undefined> {
  try {
    refuseCliSpawnUnderTest("claude --version");
    return (await resolveCliAsync("claude")).version;
  } catch {
    return undefined;
  }
}

export async function readClaudeModels(
  loadSdk: () => Promise<ClaudeModelSdk> = loadClaudeModelSdk,
  timeoutMs = MODEL_LIST_TIMEOUT_MS,
  resolveExecutable: () => string | undefined = defaultModelListExecutable,
  readVersion: () => Promise<string | undefined> = installedClaudeVersion,
): Promise<{ models: ProviderModel[]; message?: string; cliVersion?: string }> {
  let sdk: ClaudeModelSdk;
  try {
    sdk = await loadSdk();
  } catch (error) {
    return { models: [], message: error instanceof Error ? error.message : "the Claude Agent SDK is not available" };
  }
  // A prompt that never yields keeps the SDK in streaming-input mode: the CLI answers
  // control requests without starting a billed turn. The abort in `finally` stops it.
  const controller = new AbortController();
  async function* silent(): AsyncGenerator<never> {
    await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const executable = resolveExecutable();
    const session = sdk.query({
      prompt: silent(),
      options: {
        cwd: process.cwd(),
        permissionMode: "default",
        abortController: controller,
        persistSession: false,
        // The packaged app excludes the SDK's bundled CLI, so the handshake must use the installed one.
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      },
    });
    const models = await Promise.race([
      session.supportedModels(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("claude did not answer with its models in time")), timeoutMs);
      }),
    ]);
    const rows = await withClaudeDefaultEfforts(session, parseClaudeModels(models), timeoutMs);
    const cliVersion = await readVersion();
    return { models: rows, ...(cliVersion ? { cliVersion } : {}) };
  } catch (error) {
    return { models: [], message: error instanceof Error ? error.message : "claude did not answer with its models" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

async function withClaudeDefaultEfforts(session: ClaudeModelQuery, rows: ProviderModel[], timeoutMs: number): Promise<ProviderModel[]> {
  if (!session.setModel || !session.getSettings) return rows;
  const deadline = Date.now() + timeoutMs;
  const out: ProviderModel[] = [];
  for (const row of rows) {
    const left = deadline - Date.now();
    if (row.efforts.length === 0 || left <= 0) {
      out.push(row);
      continue;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const settings = await Promise.race([
        session.setModel(row.id).then(() => session.getSettings!()),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), left);
        }),
      ]);
      const effort = (settings as { applied?: { effort?: unknown } } | undefined)?.applied?.effort;
      out.push(typeof effort === "string" && CLAUDE_EFFORTS.has(effort) ? { ...row, defaultEffort: effort } : row);
    } catch {
      out.push(row);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return out;
}

function codexServiceTiers(row: Record<string, unknown>): Pick<ProviderModel, "serviceTiers" | "defaultServiceTier"> {
  const tiers = Array.isArray(row.serviceTiers)
    ? row.serviceTiers.flatMap((entry) => {
        const tier = entry as { id?: unknown; name?: unknown; description?: unknown };
        if (typeof tier?.id !== "string" || !tier.id || typeof tier.name !== "string" || !tier.name) return [];
        return [{ id: tier.id, name: tier.name, ...(typeof tier.description === "string" && tier.description ? { description: tier.description } : {}) }];
      })
    : [];
  return {
    ...(tiers.length > 0 ? { serviceTiers: tiers } : {}),
    ...(typeof row.defaultServiceTier === "string" && row.defaultServiceTier ? { defaultServiceTier: row.defaultServiceTier } : {}),
  };
}

export function parseCodexModels(payload: unknown): ProviderModel[] {
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((entry) => {
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : typeof row.model === "string" ? row.model : "";
    if (!id) return [];
    const efforts = Array.isArray(row.supportedReasoningEfforts)
      ? row.supportedReasoningEfforts.flatMap((level) => {
          const value = (level as { reasoningEffort?: unknown })?.reasoningEffort;
          return typeof value === "string" && value ? [value] : [];
        })
      : [];
    return [
      {
        id,
        label: typeof row.displayName === "string" && row.displayName ? row.displayName : id,
        ...(typeof row.description === "string" && row.description ? { description: row.description } : {}),
        isDefault: row.isDefault === true,
        hidden: row.hidden === true,
        hiddenByUser: false,
        legacy: false,
        source: "provider",
        efforts,
        ...(typeof row.defaultReasoningEffort === "string" && row.defaultReasoningEffort
          ? { defaultEffort: row.defaultReasoningEffort }
          : {}),
        ...codexServiceTiers(row),
        fastMode: false,
      },
    ];
  });
}

async function readCodexModels(
  spawnServer: () => CodexAppServer = () => new CodexAppServer(resolveCodexBinary(), process.env),
  readWindows: () => Promise<ReadonlyMap<string, CodexWindow>> = async () => readCodexWindows(resolveCodexBinary()),
): Promise<{ models: ProviderModel[]; message?: string }> {
  let client: CodexAppServer;
  try {
    client = spawnServer();
  } catch (error) {
    return { models: [], message: error instanceof Error ? error.message : "codex is not available" };
  }
  try {
    await client.request("initialize", {
      clientInfo: { name: "telar", title: "Telar", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    client.notify("initialized");
    const models = parseCodexModels(await client.request("model/list", {}));
    return { models: withCodexLongRows(models, await readWindows().catch(() => new Map<string, CodexWindow>())) };
  } catch (error) {
    return { models: [], message: error instanceof Error ? error.message : "codex did not answer model/list" };
  } finally {
    client.kill();
  }
}

async function readOpenCodeModels(): Promise<{ models: ProviderModel[]; message?: string }> {
  try {
    const executable = requireCli("opencode");
    const { stdout } = await promisify(execFile)(executable, ["models"], { timeout: MODEL_LIST_TIMEOUT_MS, maxBuffer: 2_000_000 });
    const ids = [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Za-z0-9_.-]+\/\S+$/.test(line)))];
    return { models: ids.map((id) => ({ id, label: id, efforts: [], isDefault: false, hidden: false, fastMode: false, hiddenByUser: false, legacy: false, source: "provider" as const })) };
  } catch (error) { return { models: [], message: error instanceof Error ? error.message : "OpenCode did not answer models" }; }
}

const ACRONYMS = new Set(["gpt", "glm"]);

export function readableModelName(name: string): string {
  const words = name.split("-").filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const previous = out.at(-1);
    if (/^\d+$/.test(word) && previous && /^\d+(\.\d+)*$/.test(previous)) out[out.length - 1] = `${previous}.${word}`;
    else out.push(ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1));
  }
  return out.join(" ") || name;
}

const variantOf = (value: string): string =>
  (/\[(.*)\]$/.exec(value)?.[1] ?? "")
    .split(",")
    .map((pair) => pair.split("="))
    .flatMap(([key, setting]) => (!key || setting === "false" ? [] : setting === "true" || setting === undefined ? [key] : [`${key} ${setting}`]))
    .join(" · ");

type AcpModelOption = { value?: unknown; name?: unknown; options?: unknown };

export function parseAcpModelOption(session: unknown): ProviderModel[] {
  const configOptions = (session as { configOptions?: unknown })?.configOptions;
  const option = (Array.isArray(configOptions) ? configOptions : []).find((entry) => entry?.category === "model" || entry?.id === "model") as
    | { currentValue?: unknown; options?: unknown }
    | undefined;
  const flatten = (entries: unknown): AcpModelOption[] =>
    (Array.isArray(entries) ? (entries as AcpModelOption[]) : []).flatMap((entry) => (typeof entry?.value === "string" ? [entry] : flatten(entry?.options)));
  return flatten(option?.options).flatMap((entry) => {
    const id = entry.value as string;
    if (!id) return [];
    const variant = variantOf(id);
    return [{
      id,
      label: readableModelName(typeof entry.name === "string" && entry.name ? entry.name : id),
      ...(variant ? { description: variant } : {}),
      isDefault: id === option?.currentValue,
      hidden: false,
      hiddenByUser: false,
      legacy: false,
      source: "provider" as const,
      efforts: [],
      fastMode: false,
    }];
  });
}

function spawnCursorAgent(cwd: string): AcpConnection {
  return new AcpConnection(requireCli("cursor"), ["acp"], { cwd, env: agentEnv() });
}

export async function readCursorModels(
  spawnAgent: (cwd: string) => AcpConnection = spawnCursorAgent,
  timeoutMs = MODEL_LIST_TIMEOUT_MS,
): Promise<{ models: ProviderModel[]; message?: string }> {
  const cwd = path.join(os.tmpdir(), "telar-cursor");
  fs.mkdirSync(cwd, { recursive: true });
  let rpc: AcpConnection | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const agent = spawnAgent(cwd);
    rpc = agent;
    const exchange = async () => {
      await agent.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "telar", title: "Telar", version: "0.1.0" },
      });
      return parseAcpModelOption(await agent.request("session/new", { cwd, mcpServers: [] }));
    };
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Cursor did not answer with its models in time")), timeoutMs);
    });
    return { models: await Promise.race([exchange(), timeout]) };
  } catch (error) {
    return { models: [], message: error instanceof Error ? error.message : "Cursor did not answer with its models" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    rpc?.kill();
  }
}

export async function readModelCatalogue(
  driver: ProviderDriverKind,
  now: () => number,
  readCodex: typeof readCodexModels = readCodexModels,
  readClaude: typeof readClaudeModels = readClaudeModels,
  readCursor: typeof readCursorModels = readCursorModels,
): Promise<ModelCatalogue> {
  const answer: { models: ProviderModel[]; message?: string; cliVersion?: string } =
    driver === "claude"
      ? await readClaude()
      : driver === "opencode"
        ? await readOpenCodeModels()
        : driver === "cursor"
          ? await readCursor()
          : await readCodex();
  return {
    driver,
    models: answer.models,
    source: answer.models.length > 0 ? "provider" : "builtin",
    ...(answer.message ? { message: answer.message } : {}),
    ...(answer.cliVersion ? { cliVersion: answer.cliVersion } : {}),
    readAt: now(),
  };
}
