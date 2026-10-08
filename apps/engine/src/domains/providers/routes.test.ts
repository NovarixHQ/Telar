import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, type ProviderInstance, type UsageLimitWindow } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function engine(readProviderLimits?: (instance: ProviderInstance) => Promise<UsageLimitWindow[]>) {
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "telar-provider-routes-"));
  roots.push(engineRoot);
  const daemon = await startEngine({ models: stubModels, engineRoot, ...(readProviderLimits ? { readProviderLimits } : {}) });
  daemons.push(daemon);
  return new EngineClient(daemon.discovery);
}

test("a Codex login's usage limits are read with its secrets, and other drivers are refused", async () => {
  const asked: ProviderInstance[] = [];
  const client = await engine(async (instance) => {
    asked.push(instance);
    return [{ key: "primary", label: "5 h", usedPercent: 42 }];
  });
  await client.saveProviderInstance({ id: "codex", env: [{ name: "OPENAI_API_KEY", value: "sk-test", sensitive: true }] });

  await expect(client.providerLimits("codex")).resolves.toEqual({ windows: [{ key: "primary", label: "5 h", usedPercent: 42 }] });
  expect(asked[0]?.env).toContainEqual({ name: "OPENAI_API_KEY", value: "sk-test", sensitive: true });
  await expect(client.providerLimits("claude")).rejects.toMatchObject({ status: 409 });
  await expect(client.providerLimits("nobody")).rejects.toMatchObject({ status: 404 });
});

test("extra arguments are kept as typed, cleared by null, and an unclosed quote is refused", async () => {
  const client = await engine();
  const saved = await client.saveProviderInstance({ id: "codex", extraArgs: '  -c model_verbosity="low" ' });
  expect(saved.providerInstance.extraArgs).toBe('-c model_verbosity="low"');

  await expect(client.saveProviderInstance({ id: "codex", extraArgs: '--name "open' })).rejects.toMatchObject({ status: 400 });
  const cleared = await client.saveProviderInstance({ id: "codex", extraArgs: null });
  expect(cleared.providerInstance.extraArgs).toBeUndefined();
});

test("an agent login needs the command that starts it, and has no model list of its own", async () => {
  const client = await engine();
  await expect(client.saveProviderInstance({ id: "agent_sample", driver: "acp" })).rejects.toMatchObject({ status: 400 });
  const saved = await client.saveProviderInstance({ id: "agent_sample", driver: "acp", displayName: "Sample", binaryPath: "/opt/agents/sample", extraArgs: "--acp" });
  expect(saved.providerInstance).toMatchObject({ driver: "acp", binaryPath: "/opt/agents/sample", extraArgs: "--acp" });
  await expect(client.modelCatalogue("acp")).resolves.toMatchObject({ catalogue: { driver: "acp", models: [] } });
});

test("the agent catalog lists what installs here, and an install becomes an agent login pinned to its version", async () => {
  const registry = {
    agents: [
      { id: "sample", name: "Sample", version: "1.2.3", description: "An agent", distribution: { npx: { package: "@example/acp@1.2.3", args: ["--acp"] } } },
      { id: "nowhere", name: "Nowhere", version: "1.0.0", description: "", distribution: { binary: { "plan9-mips": { archive: "https://example.test/x", cmd: "x" } } } },
      { id: "Bad Id", name: "Broken", version: "1", distribution: {} },
    ],
  };
  let fetches = 0;
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "telar-provider-routes-"));
  roots.push(engineRoot);
  const daemon = await startEngine({
    models: stubModels,
    engineRoot,
    agentInstall: {
      fetch: (async () => {
        fetches++;
        return Response.json(registry);
      }) as unknown as typeof fetch,
      which: () => "/bin/bun",
      run: async (_command, _args, { cwd }) => {
        fs.mkdirSync(path.join(cwd, "node_modules", "@example", "acp"), { recursive: true });
        fs.writeFileSync(path.join(cwd, "node_modules", "@example", "acp", "package.json"), JSON.stringify({ bin: "cli.js" }));
      },
    },
  });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);

  const catalog = await client.agentCatalog();
  expect(catalog.agents.map((agent) => [agent.id, agent.distribution ?? null])).toEqual([["sample", "npm"], ["nowhere", null]]);
  await client.agentCatalog();
  expect(fetches).toBe(1);

  const { providerInstance } = await client.installAgent("sample");
  expect(providerInstance).toMatchObject({ id: "agent_sample", driver: "acp", displayName: "Sample", extraArgs: "--acp", binaryPath: path.join(engineRoot, "agents", "sample", "1.2.3", "node_modules", ".bin", "acp") });
  expect((await client.agentCatalog()).agents[0]).toMatchObject({ installed: { version: "1.2.3", instanceId: "agent_sample" } });
  await expect(client.installAgent("absent")).rejects.toMatchObject({ status: 404 });
});
