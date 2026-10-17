import { afterEach, describe, expect, test } from "bun:test";
import { STATE_VERSION } from "../../../platform/kernel";
import type { EngineStore } from "../../../state";
import { call, catalogueRow, cleanUp, engine, wall } from "./test-helpers";

afterEach(cleanUp);

function withCursorModels(store: EngineStore, count = 3): void {
  const models = Array.from({ length: count }, (_, index) =>
    catalogueRow(index === 0 ? "grok-4.7" : `vendor-model-${index}-with-a-long-identifier`, { label: index === 0 ? "Grok 4.7" : `Vendor model number ${index}`, efforts: ["low", "high"] }),
  );
  store.kernel.writeDocument(store.kernel.paths.modelCatalogues, {
    version: STATE_VERSION,
    entries: [{ catalogue: { driver: "cursor", models, source: "provider", readAt: Date.now(), cliVersion: "1.0.0" }, cliVersion: "1.0.0" }],
  });
}

const offered = (tools: ReturnType<typeof wall>): string[] => {
  const schema = tools.get("sessions_create")!.shape.provider as { safeParse(value: unknown): { success: boolean } };
  return ["claude", "codex", "opencode", "cursor", "gemini"].filter((id) => schema.safeParse(id).success);
};

describe("the providers an agent can start a session on", () => {
  test("the schema lists exactly the enabled providers, and a disabled OpenCode is in neither tool", async () => {
    const { store } = engine();
    store.providers.save({ id: "opencode", driver: "opencode", enabled: false });
    store.providers.save({ id: "cursor", driver: "cursor", enabled: true });
    const tools = wall(store);
    expect(offered(tools)).toEqual(["claude", "codex", "cursor"]);
    const capabilities = (await call(tools, "sessions_capabilities")).json as { providers: Array<{ instanceId: string }> };
    expect(capabilities.providers.map((provider) => provider.instanceId)).toEqual(["claude", "codex", "cursor"]);
  });

  test("a Cursor builder on Grok is created with the exact id the capabilities list", async () => {
    const { store, projectId } = engine();
    store.providers.save({ id: "cursor", driver: "cursor", enabled: true });
    withCursorModels(store);
    const tools = wall(store);
    const listed = (await call(tools, "sessions_capabilities", { provider: "cursor" })).json as { providers: Array<{ models: string[] }> };
    expect(listed.providers[0]!.models[0]).toContain("grok-4.7 · Grok 4.7 · efforts low/high");
    const created = await call(tools, "sessions_create", { projectId, envMode: "local", provider: "cursor", model: "grok-4.7", effort: "high" });
    const session = store.records.get(created.json!.id as string);
    expect(session).toMatchObject({ driver: "cursor", providerInstanceId: "cursor", model: { instanceId: "cursor", model: "grok-4.7", effort: "high" } });
  });

  test("a provider that is off or unknown is refused with the ones that work", async () => {
    const { store, projectId } = engine();
    store.providers.save({ id: "opencode", driver: "opencode", enabled: false });
    const before = store.live.all().sessions.length;
    const refused = await call(wall(store), "sessions_create", { projectId, envMode: "local", provider: "opencode" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Offered: claude, codex");
    expect(store.live.all().sessions.length).toBe(before);
  });

  test("capabilities pages a huge catalogue instead of cutting it", async () => {
    const { store } = engine();
    store.providers.save({ id: "cursor", driver: "cursor", enabled: true });
    withCursorModels(store, 200);
    const tools = wall(store);
    const seen: string[] = [];
    let after = 0;
    for (let pages = 0; pages < 20; pages += 1) {
      const page = (await call(tools, "sessions_capabilities", { provider: "cursor", after })).json as { providers: Array<{ models: string[] }>; more?: { after: number } };
      expect(JSON.stringify(page).length).toBeLessThan(8_000);
      seen.push(...page.providers.flatMap((provider) => provider.models));
      if (!page.more) break;
      after = page.more.after;
    }
    expect(seen).toHaveLength(200);
    expect(new Set(seen).size).toBe(200);
  });
});
