/**
 * THE PLUGINS PANE, DRAWN FROM THE SCHEMAS THE ENGINE PUBLISHES (P3).
 *
 * `bundled-machine-schemas.json` is exactly what the engine sends for LaTeX
 * and Data Science — an engine test fails if it drifts. Against it:
 *
 *   LaTeX          one "Plugin defaults" group: the generated rows (Default
 *                  engine, Install missing packages automatically), then the
 *                  view its machine section declares
 *   Data Science   the same group, with every field left to its view: the
 *                  detected-Python picker and the default packages
 *   a write        the generated row writes the whole blob, keeping the rest
 */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import schemas from "../../../../test-fixtures/bundled-machine-schemas.json";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { PluginsPage } = await import("./plugins-page");

const meta = (id: string, name: string, machineLabel: string, view?: string) => ({
  id,
  api: 1,
  name,
  version: "1",
  toolPrefixes: [id === "data-science" ? "ds" : id],
  readTools: [],
  eventKinds: [],
  settings: [{ id: "defaults", scope: "machine", label: machineLabel, ...(view ? { view } : {}) }],
});

const PLUGINS = [
  { meta: meta("latex", "LaTeX", "Compiling", "defaults"), state: "ready", machineSettingsSchema: schemas.latex },
  { meta: meta("data-science", "Data science", "Data science defaults", "defaults"), state: "ready", machineSettingsSchema: schemas.dataScience },
];

let machine = {
  version: 1,
  entries: {
    latex: { enabled: true, settings: { engine: "xelatex" } },
    "data-science": { enabled: true, settings: { python: "/usr/bin/python3", packages: ["pandas"] } },
  },
};
let written: unknown[] = [];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
const realSetTimeout = window.setTimeout;

beforeEach(() => {
  written = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PATCH" && url.includes("/api/plugins")) {
      const body = JSON.parse(String(init.body)) as { plugins: Record<string, unknown> };
      written.push(body.plugins);
      machine = { ...machine, entries: { ...machine.entries, ...(body.plugins as typeof machine.entries) } };
      return json({ machine });
    }
    if (url.endsWith("/api/plugins/latex/defaults")) return json({ blocks: [{ type: "text", text: "TeX distribution: what this computer compiles with." }] });
    if (url.endsWith("/api/plugins/data-science/defaults")) {
      return json({
        blocks: [
          { type: "select", label: "Default Python", name: "python", value: "/usr/bin/python3", options: [{ value: "", label: "None" }, { value: "/usr/bin/python3", label: "Python 3.12.4 — /usr/bin/python3" }], verb: "default-python" },
          { type: "heading", text: "Default packages" },
          { type: "action", label: "Save", verb: "default-packages", field: { name: "packages", value: "pandas" } },
        ],
      });
    }
    if (url.includes("/api/plugins")) return json({ plugins: PLUGINS, machine });
    return json({});
  }) as typeof fetch;
  window.setTimeout = ((fn: () => void) => {
    queueMicrotask(fn);
    return 0;
  }) as unknown as typeof window.setTimeout;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.setTimeout = realSetTimeout;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await Promise.resolve());
};

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<PluginsPage />));
  await flush();
  return { host, done: () => act(() => root.unmount()) };
}

test("each plugin's defaults are one group: the generated rows, then its declared view", async () => {
  const { host, done } = await mount();
  const latex = host.querySelector('[data-detail-for="latex"]')!;
  expect(latex.querySelectorAll("section")).toHaveLength(1);
  const text = latex.textContent ?? "";
  expect(text).toContain("Plugin defaults");
  expect(text).toContain("XeLaTeX");
  expect(text.indexOf("Default engine")).toBeLessThan(text.indexOf("Install missing packages automatically"));
  expect(text.indexOf("Install missing packages automatically")).toBeLessThan(text.indexOf("TeX distribution"));
  const science = host.querySelector('[data-detail-for="data-science"]')!;
  expect(science.querySelectorAll("section")).toHaveLength(1);
  expect(science.textContent).toContain("Python 3.12.4 — /usr/bin/python3");
  expect(science.textContent).toContain("Default packages");
  expect(science.querySelector('input[aria-label="Default Python"]')).toBeNull();
  done();
});

test("a generated row writes the plugin's whole blob and keeps the Mac switch", async () => {
  const { host, done } = await mount();
  const toggle = host.querySelector('[aria-label="Install missing packages automatically"]') as HTMLElement;
  await act(async () => toggle.click());
  await flush();
  expect(written).toEqual([{ latex: { enabled: true, settings: { engine: "xelatex", autoInstallPackages: true } } }]);
  done();
});
