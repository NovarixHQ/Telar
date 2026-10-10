/**
 * LaTeX end to end on a real TeX Live: an engine in a temp home, a temp project with LaTeX on, and a compile through
 * the plugin's session route and through the agent tool the worker builds from its manifest. Skipped where no TeX
 * Live with latexmk and pdflatex is installed, which is CI; run it locally.
 */
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, PluginManifest } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../src/daemon";
import { pluginBriefings, pluginCall } from "../../src/domains/plugins";
import { manifestToolModule } from "../../src/domains/plugins/manifest";
import type { ToolFactory } from "../../src/domains/agent-tools";
import { stubModels } from "../../test/stub-models";
import { latexPlugin } from ".";
import { latexToolchainStatus } from "./toolchain";

const texlive = (await latexToolchainStatus()).texlive.find((dist) => dist.latexmk && dist.pdflatex);

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-latex-e2e-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const GOOD = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";
const BROKEN = "\\documentclass{article}\n\\begin{document}\nHello \\nosuchmacro.\n\\end{document}\n";

type ToolAnswer = { content: { type: string; text: string }[]; isError?: boolean };

async function ready() {
  const daemon = await startEngine({ models: stubModels, engineRoot: root(), pluginsDir: root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  const checkout = root();
  fs.writeFileSync(path.join(checkout, "main.tex"), GOOD);
  fs.writeFileSync(path.join(checkout, "broken.tex"), BROKEN);
  await client.registerProject({ id: "project_one", name: "One", root: checkout });
  await client.updateProject("project_one", {
    plugins: { latex: { enabled: true, settings: { toolchain: { kind: "texlive", path: texlive!.binDir, engine: "pdflatex" }, mainFile: "main.tex" } } },
  });
  await client.createSession({ id: "session_one", projectId: "project_one" });
  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolAnswer>> = {};
  const factory: ToolFactory = (name, _description, _shape, handler) => {
    tools[name] = handler as (args: Record<string, unknown>) => Promise<ToolAnswer>;
    return { name };
  };
  const module = manifestToolModule(PluginManifest.parse(latexPlugin.manifest));
  module.tools(factory, module.capability(pluginCall(client, "session_one", "latex")));
  return { daemon, client, checkout, tools };
}

test.skipIf(!texlive)("a compile through the route writes the PDF, and the agent tool reports a broken file's errors", async () => {
  const { client, checkout, tools } = await ready();

  const good = await client.plugin<{ ok: boolean; pdfPath?: string; diagnostics: unknown[] }>("session_one", "latex", "compile", {});
  expect(good.ok).toBe(true);
  expect(good.pdfPath).toBe("main.pdf");
  expect(fs.readFileSync(path.join(checkout, "main.pdf")).subarray(0, 5).toString()).toBe("%PDF-");

  const broken = await tools.latex_compile!({ path: "broken.tex" });
  const text = broken.content[0]!.text;
  expect(text).toContain("broken.tex:3");
  expect(text).toContain("Undefined control sequence");

  const status = await client.plugin<{ status: string; path: string; diagnostics: { severity: string; file?: string; line?: number }[] }>("session_one", "latex", "status", {});
  expect(status.path).toBe("broken.tex");
  expect(status.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", file: "broken.tex", line: 3 }));
  const log = await tools.latex_log!({ find: "Undefined control sequence" });
  expect(log.content[0]!.text).toContain("nosuchmacro");
}, 120_000);

test.skipIf(!texlive)("schema and briefing come through the generic path, and disabling removes the tools and the panel", async () => {
  const { daemon, client, tools } = await ready();
  const status = (await client.machinePlugins()).plugins.find((entry) => entry.meta.id === "latex")!;
  expect(status.state).toBe("ready");
  expect(status.settingsSchema?.properties).toHaveProperty("mainFile");
  expect(status.machineSettingsSchema?.properties).toHaveProperty("autoInstallPackages");
  expect(status.meta.panels).toEqual([{ id: "compile", label: "Compile", verb: "panel" }]);
  const session = () => daemon.store.records.get("session_one");
  expect(daemon.store.toolchains.enabledIds(session())).toEqual(["latex"]);
  expect(pluginBriefings(daemon.store.toolchains.enabledIds(session()))).toEqual([status.meta.briefing!]);
  await expect(client.plugin("session_one", "latex", "panel", {})).resolves.toHaveProperty("blocks");

  await client.updateProject("project_one", { plugins: { latex: { enabled: false } } });
  expect(daemon.store.toolchains.enabledIds(session())).toEqual([]);
  expect(pluginBriefings(daemon.store.toolchains.enabledIds(session()))).toEqual([]);
  await expect(client.plugin("session_one", "latex", "panel", {})).rejects.toThrow("not enabled");
  const refused = await tools.latex_compile!({});
  expect(refused.isError).toBe(true);
  expect(refused.content[0]!.text).toContain("not enabled");
}, 120_000);
