import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { ModelCatalogue, ProviderModel, Session, UsageSnapshot } from "@telar/engine-client";
import { installTestDom, mount, flush, stubFetch } from "@/test/dom";
import { connectionMark, CURSOR_MARK } from "@/features/providers/components/connection-icon";
import { forgetModelCatalogues } from "@/features/providers/model-catalogue-cache";
import { Composer } from "./composer";

installTestDom();

const session = { id: "session_c", driver: "cursor", projectId: "project_a", workspace: { mode: "local", path: "/work" } } as Session;

const model = (id: string, label: string, over: Partial<ProviderModel> = {}) =>
  ({ id, label, isDefault: false, hidden: false, efforts: [], fastMode: false, hiddenByUser: false, legacy: false, source: "provider", ...over }) as ProviderModel;

const CURSOR_MODELS = [
  model("default[]", "Auto", { isDefault: true }),
  model("claude-opus-5-5[context=300k,effort=medium,fast=false]", "Opus 5.5"),
  model("gpt-5.6-sol[context=272k,reasoning=medium,fast=false]", "GPT-5.6 Sol"),
  model("composer-2.5[fast=true]", "Composer 2.5"),
];

function serve(models: ProviderModel[]) {
  const catalogue: ModelCatalogue = { driver: "cursor", instanceId: "cursor", models, source: "provider", readAt: 0 };
  stubFetch({ "GET /api/models": () => ({ catalogue }) });
}

function Box({ usage }: { usage?: UsageSnapshot }) {
  return (
    <Composer
      draft=""
      ready
      attachments={[]}
      onAttach={() => {}}
      busy={false}
      driver="cursor"
      sending={false}
      backgroundTasks={0}
      session={session}
      runtimeMode="full-access"
      onDraftChange={() => {}}
      onSubmit={() => {}}
      onStop={() => {}}
      onStopBackground={() => {}}
      onRuntimeMode={() => {}}
      onModelChange={() => {}}
      {...(usage ? { usage } : {})}
    />
  );
}

async function composer(usage?: UsageSnapshot) {
  const mounted = await mount(<Box {...(usage ? { usage } : {})} />);
  await flush();
  return mounted;
}

const pill = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label^="Model:"]')!;

/** The pill row in reading order: model, effort, access and each divider between them. */
const rowShape = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-slot=composer-divider], button[aria-label^="Model:"], button[aria-label^="Reasoning effort:"], button[aria-label^="Access:"]')].map((node) =>
    node.matches("[data-slot=composer-divider]") ? "|" : node.getAttribute("aria-label")!.split(":")[0],
  );

async function openPicker(host: HTMLElement) {
  await act(async () => {
    pill(host).dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    pill(host).dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    pill(host).click();
  });
  await flush();
}

const row = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("[data-model-row]")].find((node) => node.textContent?.includes(label))!;

beforeEach(() => forgetModelCatalogues());
afterEach(() => forgetModelCatalogues());

describe("a Cursor session's composer", () => {
  test("the model pill wears Cursor's mark on Auto", async () => {
    serve(CURSOR_MODELS);
    const { host } = await composer();
    expect(pill(host).getAttribute("aria-label")).toBe("Model: Auto on Cursor");
    expect(pill(host).innerHTML).toContain(CURSOR_MARK.d);
  });

  test("each model row wears its vendor's mark, and Cursor's own models wear Cursor's", async () => {
    serve(CURSOR_MODELS);
    const { host } = await composer();
    await openPicker(host);
    expect(row("Opus 5.5").innerHTML).toContain(connectionMark("anthropic")!.d);
    expect(row("Opus 5.5").textContent).toContain("Anthropic");
    expect(row("GPT-5.6 Sol").innerHTML).toContain(connectionMark("openai")!.d);
    expect(row("Auto").innerHTML).toContain(CURSOR_MARK.d);
    expect(row("Composer 2.5").innerHTML).toContain(CURSOR_MARK.d);
  });

  test("with no efforts to offer there is no effort pill and one divider before access", async () => {
    serve(CURSOR_MODELS);
    const { host } = await composer();
    expect(rowShape(host)).toEqual(["Model", "|", "Access"]);
  });

  test("a model that does publish efforts gets the effort pill, whatever the driver", async () => {
    serve([model("default[]", "Auto", { isDefault: true, efforts: ["low", "high"], defaultEffort: "high" })]);
    const { host } = await composer();
    expect(rowShape(host)).toEqual(["Model", "|", "Reasoning effort", "|", "Access"]);
  });

  test("no context ring until the provider reports a figure", async () => {
    serve(CURSOR_MODELS);
    const ring = (host: HTMLElement) => host.querySelector('button[aria-label^="Context window"]');
    expect(ring((await composer()).host)).toBeNull();
    const usage: UsageSnapshot = { tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0 }, contextUsed: 50_000, contextMax: 200_000 };
    expect(ring((await composer(usage)).host)?.getAttribute("aria-label")).toBe("Context window 25.0% used");
  });
});
