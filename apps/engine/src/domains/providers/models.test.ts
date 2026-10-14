import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { AcpConnection } from "../../drivers/acp";
import { parseAcpModelOption, parseClaudeModels, parseCodexModels, readableModelName, readClaudeModels, readCursorModels, readModelCatalogue, stripPricing } from "./models";

describe("parseCodexModels", () => {
  test("reads each model's service tiers and its default tier", () => {
    const [row] = parseCodexModels({
      data: [
        {
          id: "gpt-6-astra",
          displayName: "GPT-6 Astra",
          defaultServiceTier: "default",
          serviceTiers: [
            { id: "default", name: "Standard", description: "Standard speed" },
            { id: "priority", name: "Fast", description: "Faster, at a higher rate" },
            { id: "", name: "nameless" },
          ],
        },
      ],
    });
    expect(row?.serviceTiers).toEqual([
      { id: "default", name: "Standard", description: "Standard speed" },
      { id: "priority", name: "Fast", description: "Faster, at a higher rate" },
    ]);
    expect(row?.defaultServiceTier).toBe("default");
    expect(parseCodexModels({ data: [{ id: "gpt-5-codex" }] })[0]?.serviceTiers).toBeUndefined();
  });

  test("reads `model/list`'s real shape, per-model efforts and all", () => {
    const models = parseCodexModels({
      data: [
        {
          id: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6-Sol",
          description: "Latest frontier agentic coding model.",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "low",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "max" }, { reasoningEffort: "ultra" }],
        },
      ],
    });
    expect(models).toEqual([
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6-Sol",
        description: "Latest frontier agentic coding model.",
        isDefault: true,
        hidden: false,
        efforts: ["low", "max", "ultra"],
        defaultEffort: "low",
        fastMode: false,
        hiddenByUser: false,
        legacy: false,
        source: "provider",
      },
    ]);
  });

  test("a row from a newer or older codex degrades instead of throwing", () => {
    expect(parseCodexModels({ data: [{ id: "x" }] })).toEqual([
      { id: "x", label: "x", isDefault: false, hidden: false, efforts: [], fastMode: false, hiddenByUser: false, legacy: false, source: "provider" },
    ]);
    expect(parseCodexModels({ data: [{ displayName: "no id" }] })).toEqual([]);
    expect(parseCodexModels({})).toEqual([]);
    expect(parseCodexModels(null)).toEqual([]);
  });
});

const CLAUDE_ROWS = [
  {
    value: "default",
    resolvedModel: "claude-opus-5[1m]",
    displayName: "Default (recommended)",
    description: "Use the default model (currently Opus 5 (1M context)) · $5/$25 per Mtok",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsFastMode: true,
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5 with 1M context · Best for everyday, complex tasks · $5/$25 per Mtok",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsFastMode: true,
  },
  {
    value: "claude-fable-5[1m]",
    resolvedModel: "claude-fable-5[1m]",
    displayName: "Fable",
    description: "Fable 5 · Most capable for your hardest and longest-running tasks · $10/$50 per Mtok",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks · $3/$15 per Mtok",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku", description: "Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok" },
];

describe("parseClaudeModels", () => {
  test("the `default` row is folded into the model it resolves to", () => {
    const models = parseClaudeModels(CLAUDE_ROWS);
    expect(models.map((model) => model.id)).toEqual(["opus[1m]", "claude-fable-5[1m]", "sonnet", "haiku"]);
    expect(models.find((model) => model.isDefault)?.id).toBe("opus[1m]");
    expect(models.filter((model) => model.isDefault)).toHaveLength(1);
  });

  test("Haiku reports NO effort levels, which the hand-written list got wrong", () => {
    const models = parseClaudeModels(CLAUDE_ROWS);
    expect(models.find((model) => model.id === "haiku")?.efforts).toEqual([]);
    expect(models.find((model) => model.id === "sonnet")?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("fast mode is per model, and most models do not have it", () => {
    const models = parseClaudeModels(CLAUDE_ROWS);
    expect(models.filter((model) => model.fastMode).map((model) => model.id)).toEqual(["opus[1m]"]);
  });

  test("the alias's canonical id is carried, so a stored wire id can be matched back", () => {
    expect(parseClaudeModels(CLAUDE_ROWS).find((model) => model.id === "sonnet")?.resolves).toBe("claude-sonnet-5");
  });

  test("prices are stripped, because this cockpit reports tokens", () => {
    expect(parseClaudeModels(CLAUDE_ROWS).find((model) => model.id === "sonnet")?.description).toBe("Sonnet 5 · Efficient for routine tasks");
  });

  test("the default row SURVIVES when nothing else covers it", () => {
    const models = parseClaudeModels([{ value: "default", resolvedModel: "claude-opus-9", displayName: "Default" }]);
    expect(models).toEqual([{ id: "default", label: "Default", isDefault: true, hidden: false, efforts: [], resolves: "claude-opus-9", fastMode: false, hiddenByUser: false, legacy: false, source: "provider" }]);
  });

  test("a row from a newer or older claude degrades instead of throwing", () => {
    expect(parseClaudeModels([{ value: "x" }])).toEqual([
      { id: "x", label: "x", isDefault: false, hidden: false, efforts: [], fastMode: false, hiddenByUser: false, legacy: false, source: "provider" },
    ]);
    expect(parseClaudeModels([{ value: "x", supportedEffortLevels: ["high", "ultra"] }])[0]!.efforts).toEqual(["high"]);
    expect(parseClaudeModels([{ displayName: "no value" }])).toEqual([]);
    expect(parseClaudeModels(null)).toEqual([]);
  });
});

describe("stripPricing", () => {
  test("drops the rate clause and keeps the rest", () => {
    expect(stripPricing("Sonnet 5 · Efficient for routine tasks · $3/$15 per Mtok")).toBe("Sonnet 5 · Efficient for routine tasks");
    expect(stripPricing("No price here")).toBe("No price here");
    expect(stripPricing("$5/$25 per Mtok")).toBe("");
  });
});

describe("readClaudeModels", () => {
  test("asks the SDK and never sends a turn", async () => {
    let prompted: AsyncIterable<never> | undefined;
    const answer = await readClaudeModels(async () => ({
      query: (input) => {
        prompted = input.prompt;
        return { supportedModels: async () => CLAUDE_ROWS };
      },
    }));
    expect(answer.models.map((model) => model.id)).toEqual(["opus[1m]", "claude-fable-5[1m]", "sonnet", "haiku"]);
    expect(prompted).toBeDefined();
  });

  test("each model's default effort is what the CLI reports it would send", async () => {
    const applied: Record<string, string | null> = { "opus[1m]": "medium", sonnet: "xhigh", "claude-fable-5[1m]": null };
    let current = "";
    const asked: string[] = [];
    const answer = await readClaudeModels(async () => ({
      query: () => ({
        supportedModels: async () => CLAUDE_ROWS,
        setModel: async (model?: string) => {
          asked.push(model ?? "");
          current = model ?? "";
        },
        getSettings: async () => ({ applied: { model: current, effort: applied[current] ?? null } }),
      }),
    }));
    const byId = new Map(answer.models.map((model) => [model.id, model]));
    expect(byId.get("opus[1m]")?.defaultEffort).toBe("medium");
    expect(byId.get("sonnet")?.defaultEffort).toBe("xhigh");
    expect(byId.get("claude-fable-5[1m]")?.defaultEffort).toBeUndefined();
    expect(asked).not.toContain("haiku");
  });

  test("a model the CLI will not switch to, or an SDK without getSettings, keeps the list", async () => {
    const refused = await readClaudeModels(async () => ({
      query: () => ({
        supportedModels: async () => CLAUDE_ROWS,
        setModel: async (model?: string) => {
          if (model === "sonnet") throw new Error("Couldn't confirm model");
        },
        getSettings: async () => ({ applied: { effort: "high" } }),
      }),
    }));
    expect(refused.models.map((model) => model.id)).toEqual(["opus[1m]", "claude-fable-5[1m]", "sonnet", "haiku"]);
    expect(refused.models.find((model) => model.id === "sonnet")?.defaultEffort).toBeUndefined();
    expect(refused.models.find((model) => model.id === "opus[1m]")?.defaultEffort).toBe("high");

    const older = await readClaudeModels(async () => ({ query: () => ({ supportedModels: async () => CLAUDE_ROWS }) }));
    expect(older.models.every((model) => model.defaultEffort === undefined)).toBe(true);
  });

  test("a default probe that hangs does not cost the model list", async () => {
    const answer = await readClaudeModels(
      async () => ({
        query: () => ({
          supportedModels: async () => CLAUDE_ROWS,
          setModel: () => new Promise<void>(() => undefined),
          getSettings: async () => ({ applied: { effort: "high" } }),
        }),
      }),
      5,
    );
    expect(answer.models).toHaveLength(4);
    expect(answer.models.every((model) => model.defaultEffort === undefined)).toBe(true);
  });

  test("a provider that will not answer costs a sentence, not a hung popover", async () => {
    const answer = await readClaudeModels(
      async () => ({ query: () => ({ supportedModels: () => new Promise(() => undefined) }) }),
      5,
    );
    expect(answer.models).toEqual([]);
    expect(answer.message).toContain("in time");
  });

  test("an SDK that will not load is reported rather than thrown", async () => {
    const answer = await readClaudeModels(async () => {
      throw new Error("claude is not installed");
    });
    expect(answer).toEqual({ models: [], message: "claude is not installed" });
  });

  test("the handshake names the user's own binary, exactly as a turn does", async () => {
    let options: Record<string, unknown> | undefined;
    await readClaudeModels(
      async () => ({
        query: (input) => {
          options = input.options;
          return { supportedModels: async () => CLAUDE_ROWS };
        },
      }),
      1_000,
      () => "/resolved/bin/claude",
    );
    expect(options?.pathToClaudeCodeExecutable).toBe("/resolved/bin/claude");

    await readClaudeModels(
      async () => ({
        query: (input) => {
          options = input.options;
          return { supportedModels: async () => CLAUDE_ROWS };
        },
      }),
      1_000,
      () => undefined,
    );
    expect("pathToClaudeCodeExecutable" in (options ?? {})).toBe(false);
  });
});

describe("readModelCatalogue", () => {
  test("both providers are asked, and an answer is marked as the provider's", async () => {
    const catalogue = await readModelCatalogue(
      "claude",
      () => 5,
      async () => ({ models: [] }),
      async () => ({ models: parseClaudeModels(CLAUDE_ROWS) }),
    );
    expect(catalogue).toMatchObject({ driver: "claude", source: "provider", readAt: 5 });
    expect(catalogue.models.find((model) => model.isDefault)?.id).toBe("opus[1m]");
  });

  test("a provider that cannot be asked returns NOTHING, with the reason", async () => {
    for (const driver of ["claude", "codex"] as const) {
      const catalogue = await readModelCatalogue(
        driver,
        () => 1,
        async () => ({ models: [], message: "not installed" }),
        async () => ({ models: [], message: "not installed" }),
      );
      expect(catalogue).toMatchObject({ models: [], source: "builtin", message: "not installed" });
    }
  });
});

describe("Cursor's models", () => {
  const FAKE = fileURLToPath(new URL("../../../test/fixtures/fake-acp-agent.mjs", import.meta.url));

  test("the catalogue is the live session's model option, read from the same directory every time", async () => {
    const dirs: string[] = [];
    const read = () =>
      readCursorModels((cwd) => {
        dirs.push(cwd);
        return new AcpConnection(process.execPath, [FAKE], { cwd, env: { ...process.env, ACP_FAKE_SCRIPT: "options" } });
      });
    const { models, message } = await read();
    await read();
    expect(message).toBeUndefined();
    expect(models.map((model) => [model.id, model.label, model.isDefault, model.efforts])).toEqual([
      ["fast", "Fast", true, []],
      ["smart", "Smart", false, []],
    ]);
    expect(dirs[0]).toBe(dirs[1]!);
  });

  test("an agent that will not start is a reason, not a throw", async () => {
    const { models, message } = await readCursorModels(() => {
      throw new Error("Cursor is not installed");
    });
    expect(models).toEqual([]);
    expect(message).toBe("Cursor is not installed");
  });

  test("ids stay exactly what the agent accepts; labels and variants are made readable", () => {
    const models = parseAcpModelOption({
      configOptions: [
        { id: "mode", category: "mode", currentValue: "agent", options: [{ value: "agent", name: "Agent" }] },
        {
          id: "model",
          category: "model",
          currentValue: "default[]",
          options: [
            { value: "default[]", name: "Auto" },
            { value: "claude-opus-5-5[context=300k,effort=medium,fast=false]", name: "claude-opus-5-5" },
            { value: "composer-2.5[fast=true]", name: "composer-2.5" },
          ],
        },
      ],
    });
    expect(models.map((model) => [model.id, model.label, model.description, model.isDefault])).toEqual([
      ["default[]", "Auto", undefined, true],
      ["claude-opus-5-5[context=300k,effort=medium,fast=false]", "Claude Opus 5.5", "context 300k · effort medium", false],
      ["composer-2.5[fast=true]", "Composer 2.5", "fast", false],
    ]);
    expect(readableModelName("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
    expect(readableModelName("kimi-k2.7-code")).toBe("Kimi K2.7 Code");
  });

  test("the catalogue asks Cursor's own reader for the cursor driver", async () => {
    const catalogue = await readModelCatalogue("cursor", () => 3, undefined, undefined, async () => ({ models: parseAcpModelOption({ configOptions: [{ id: "model", options: [{ value: "a[]", name: "a" }] }] }) }));
    expect(catalogue).toMatchObject({ driver: "cursor", source: "provider", models: [{ id: "a[]" }] });
  });
});
