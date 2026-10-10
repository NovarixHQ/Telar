/**
 * LaTeX ships with the app but loads on the contract an installed plugin uses: a manifest plus an engine module,
 * reached through the generic doors. Temp engine root and checkout; a fake `tectonic` stands in for TeX.
 */
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, TELAR_MCP_SERVER, canonicalToolName, parsePluginPanelView, parseToolName, pluginEnabled, readProjectPlugins } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../src/daemon";
import { bundledPluginToolModules } from "../../src/domains/plugins";
import { ECHO_MANIFEST, writePlugin } from "../../test/fixtures/external-plugin";
import { stubModels } from "../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-latex-plugin-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

type Answer = { status: number; body: { error?: { message: string } } & Record<string, unknown> };

async function call(daemon: EngineDaemon, method: string, pathname: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${daemon.discovery.port}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Answer["body"] };
}

const door = (daemon: EngineDaemon, verb: string, body: unknown = {}) => call(daemon, "POST", `/v2/sessions/session_one/${verb}`, body);

/** Writes `<outdir>/<name>.pdf` and a log the parser reads, the way Tectonic would. */
function fakeTectonic(): string {
  const file = path.join(root(), "tectonic");
  fs.writeFileSync(file, '#!/bin/sh\nwhile [ "$1" != "--outdir" ]; do shift; done\nout="$2"; base=$(basename "$3" .tex)\nmkdir -p "$out"\necho "%PDF-1.5" > "$out/$base.pdf"\necho "Output written on $base.pdf" > "$out/$base.log"\n', { mode: 0o755 });
  return file;
}

async function ready(options: { enable?: boolean; tectonic?: string; pluginsDir?: string } = {}) {
  const daemon = await startEngine({ models: stubModels, engineRoot: root(), pluginsDir: options.pluginsDir ?? root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  const checkout = root();
  fs.mkdirSync(path.join(checkout, ".git"));
  fs.writeFileSync(path.join(checkout, "main.tex"), "\\documentclass{article}\\begin{document}Hi\\end{document}\n");
  await client.registerProject({ id: "project_one", name: "One", root: checkout });
  if (options.enable) {
    const settings = options.tectonic ? { toolchain: { kind: "tectonic", path: options.tectonic }, mainFile: "main.tex" } : {};
    await client.updateProject("project_one", { plugins: { latex: { enabled: true, settings } } });
  }
  await client.createSession({ id: "session_one", projectId: "project_one" });
  return { daemon, client, checkout };
}

test("LaTeX loads from its manifest like an installed plugin, and the host decides its reads", async () => {
  const { client } = await ready();
  const latex = (await client.health()).plugins?.find((status) => status.meta.id === "latex");
  expect(latex?.state).toBe("ready");
  expect(latex?.meta.readTools).toEqual([]);
  expect(latex?.meta.panels).toEqual([{ id: "compile", label: "Compile", verb: "panel" }]);
  expect(latex?.meta.settings.map((section) => [section.scope, section.view])).toEqual([["machine", "defaults"], ["project", "settings"]]);
  expect(latex?.machineSettingsSchema?.properties).toMatchObject({ engine: { title: "Default engine" } });
});

test("a user plugin cannot take the bundled id or prefix, and an external plugin beside them loads as before", async () => {
  const pluginsDir = root();
  writePlugin(pluginsDir, "latex", { ...ECHO_MANIFEST, id: "latex" });
  writePlugin(pluginsDir, "mytex", { ...ECHO_MANIFEST, id: "mytex", toolPrefix: "latex", tools: [] });
  writePlugin(pluginsDir, "echo");
  const { client, daemon } = await ready({ pluginsDir });
  const byId = Object.fromEntries((await client.machinePlugins()).plugins.map((status) => [status.meta.id, status]));
  expect(byId.latex).toMatchObject({ state: "ready", meta: { name: "LaTeX", toolPrefixes: ["latex"] } });
  expect(byId.latex?.installed).toBeUndefined();
  expect(byId.mytex).toMatchObject({ state: "failed", error: expect.stringContaining('tool prefix "latex" is already owned') });
  expect(byId.echo).toMatchObject({ state: "ready", installed: { linked: false }, meta: { toolPrefixes: ["echo"] } });
  await client.updateProject("project_one", { plugins: { echo: { enabled: true } } });
  expect(await door(daemon, "plugins/echo/tool", { name: "echo_say", arguments: { text: "hi" } })).toEqual({ status: 200, body: { content: [{ type: "text", text: "echo: hi" }] } });
  expect(fs.existsSync(path.join(pluginsDir, "latex", "plugin.json"))).toBe(true);
});

test("the released door and the generic door answer alike, and refuse alike while LaTeX is off", async () => {
  const off = await ready();
  expect((await door(off.daemon, "latex/status")).body.error?.message).toContain("not enabled");
  expect((await door(off.daemon, "plugins/latex/status")).body.error?.message).toContain("not enabled");
  const on = await ready({ enable: true });
  const legacy = await door(on.daemon, "latex/status");
  expect(legacy.body).toEqual((await door(on.daemon, "plugins/latex/status")).body);
  expect(legacy.body).toEqual({ status: "never" });
  expect((await door(on.daemon, "plugins/latex/nosuchverb")).status).toBe(404);
});

test("a tool runs through the generic tool verb, and says why when there is no TeX", async () => {
  const { daemon } = await ready({ enable: true });
  const status = await door(daemon, "plugins/latex/tool", { name: "latex_status", arguments: {} });
  expect(status.body).toEqual({ content: [{ type: "text", text: "Nothing has been compiled in this session yet." }] });
  const compile = await door(daemon, "plugins/latex/tool", { name: "latex_compile", arguments: {} });
  expect(compile.body.isError).toBe(true);
  expect(JSON.stringify(compile.body.content)).toContain("no TeX toolchain");
});

test("a compile journals its events and the panel view shows the result", async () => {
  const { daemon, client, checkout } = await ready({ enable: true, tectonic: fakeTectonic() });
  const compiled = await door(daemon, "plugins/latex/tool", { name: "latex_compile", arguments: {} });
  expect(JSON.stringify(compiled.body.content)).toContain("Compiled main.tex → main.pdf");
  expect(fs.existsSync(path.join(checkout, "main.pdf"))).toBe(true);
  const kinds = (await client.events("session_one")).events.map((event) => event.type);
  expect(kinds).toEqual(expect.arrayContaining(["latex.compile.started", "latex.compile.finished"]));
  const view = parsePluginPanelView((await door(daemon, "plugins/latex/panel")).body);
  expect(view.skipped).toBe(0);
  expect(view.blocks).toEqual(expect.arrayContaining([
    { type: "status", text: "Compiled · main.tex", tone: "ok" },
    { type: "file", label: "Open PDF", path: "main.pdf" },
  ]));
});

test("the settings views are blocks, and their actions write the plugin's settings", async () => {
  const { daemon, checkout } = await ready({ enable: true });
  expect(fs.readFileSync(path.join(checkout, ".gitignore"), "utf8")).toContain(".telar/latex/");
  const project = parsePluginPanelView((await call(daemon, "GET", "/v2/projects/project_one/plugins/latex/settings")).body);
  expect(project.skipped).toBe(0);
  expect(project.blocks).toContainEqual(expect.objectContaining({ type: "select", label: "Default document", options: [{ value: "", label: "No default" }, { value: "main.tex", label: "main.tex" }] }));
  expect((await call(daemon, "POST", "/v2/projects/project_one/plugins/latex/document", { mainFile: "main.tex" })).status).toBe(200);
  expect(readProjectPlugins(daemon.store.projectRegistry.get("project_one")).plugins.entries.latex).toEqual({ enabled: true, settings: { mainFile: "main.tex" } });
  const tectonic = fakeTectonic();
  await call(daemon, "POST", "/v2/projects/project_one/plugins/latex/use", { kind: "tectonic", path: tectonic });
  expect(readProjectPlugins(daemon.store.projectRegistry.get("project_one")).plugins.entries.latex?.settings).toEqual({ mainFile: "main.tex", toolchain: { kind: "tectonic", path: tectonic } });
  const machine = parsePluginPanelView((await call(daemon, "GET", "/v2/plugins/latex/defaults")).body);
  expect(machine.blocks).toContainEqual(expect.objectContaining({ type: "option", title: "Telar (managed)" }));
  const refused = await call(daemon, "POST", "/v2/plugins/latex/default", { kind: "texlive" });
  expect(refused.body.error?.message).toContain("needs the path");
});

/** Rewrite the registry as an engine older than the map left it, and restart. */
async function restartOnLegacyRecord(daemon: EngineDaemon, latex: Record<string, unknown>) {
  const home = daemon.store.paths.root;
  const file = path.join(home, "projects.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  parsed.projects = parsed.projects.map((project: Record<string, unknown>) => {
    const { plugins: _stripped, ...rest } = project;
    return { ...rest, latex };
  });
  fs.writeFileSync(file, JSON.stringify(parsed));
  await daemon.close();
  daemons.splice(daemons.indexOf(daemon), 1);
  const restarted = await startEngine({ models: stubModels, engineRoot: home });
  daemons.push(restarted);
  return { restarted, file };
}

test("a legacy LaTeX block an older engine left folds into the map on open, and the doors open on it", async () => {
  const { daemon } = await ready();
  const legacy = { enabled: true, mainFile: "paper.tex", toolchain: { kind: "texlive", path: "/bin/echo" } };
  const { restarted, file } = await restartOnLegacyRecord(daemon, legacy);

  const stored = JSON.parse(fs.readFileSync(file, "utf8")).projects[0];
  expect("latex" in stored).toBe(false);
  expect(stored.plugins.entries.latex).toEqual({
    enabled: true,
    settings: { mainFile: "paper.tex", toolchain: { kind: "texlive", path: "/bin/echo" } },
  });
  // The settings are not just stored — they are what the doors resolve.
  expect((await door(restarted, "latex/status")).status).toBe(200);
  expect((await door(restarted, "plugins/latex/status")).status).toBe(200);
});

test("a DISABLED legacy LaTeX block stays off after the fold, and re-opening is a no-op", async () => {
  const { daemon } = await ready();
  const { restarted, file } = await restartOnLegacyRecord(daemon, {
    enabled: false,
    mainFile: "paper.tex",
    toolchain: { kind: "texlive", path: "/bin/echo" },
  });

  const stored = JSON.parse(fs.readFileSync(file, "utf8")).projects[0];
  expect(pluginEnabled(readProjectPlugins(stored).plugins, "latex")).toBe(false);
  expect(stored.plugins.entries.latex.settings).toEqual({ mainFile: "paper.tex", toolchain: { kind: "texlive", path: "/bin/echo" } });
  expect((await door(restarted, "latex/status")).body.error?.message).toContain("not enabled");

  const before = fs.readFileSync(file, "utf8");
  const home = restarted.store.paths.root;
  await restarted.close();
  daemons.splice(daemons.indexOf(restarted), 1);
  const again = await startEngine({ models: stubModels, engineRoot: home });
  daemons.push(again);
  expect(again.store.pluginFieldMigration).toBe(0);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});

test("LaTeX's tools keep their shipped names, so no stored approval is orphaned", () => {
  expect(canonicalToolName(TELAR_MCP_SERVER, "latex_compile")).toBe("mcp__telar__latex_compile");
  expect(parseToolName("mcp__telar__latex_compile").capability).toBe("latex");
  expect(bundledPluginToolModules().map((module) => module.meta.id)).toContain("latex");
});
