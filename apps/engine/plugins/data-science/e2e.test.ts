/**
 * Data Science end to end on a real Python: an engine in a temp home, a project whose venv has pandas and matplotlib,
 * and a kernel driven through the plugin's routes and the tool wall the worker builds from its manifest.
 * Skipped without uv or with TELAR_SKIP_KERNEL_TESTS=1, like the other kernel tests; run it locally.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, PluginManifest, pluginEventsIn, type EngineEvent } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../src/daemon";
import { pluginBriefings, pluginCall } from "../../src/domains/plugins";
import { manifestToolModule } from "../../src/domains/plugins/manifest";
import type { ToolFactory } from "../../src/domains/agent-tools";
import { stubModels } from "../../test/stub-models";
import { STUB_CAPABILITIES } from "../../test/stub-driver";
import { dataSciencePlugin } from ".";
import { telarVenvPython } from "./telar-venv";

function hasUv(): boolean {
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const skip = !hasUv() || process.env.TELAR_SKIP_KERNEL_TESTS === "1";

type ToolAnswer = { content: { type: string; text: string }[]; isError?: boolean };
type Output = { kind: string; text?: string; attachmentId?: string; mediaType?: string };

async function until<T>(read: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(skip)("data science on a real kernel", () => {
  let home: string;
  let checkout: string;
  let python: string;
  let daemon: EngineDaemon;
  let client: EngineClient;
  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolAnswer>> = {};
  const call = <T,>(verb: string, body: Record<string, unknown> = {}) => client.plugin<T>("session_one", "data-science", verb, body);
  const events = async () => (await client.events("session_one")).events as EngineEvent[];
  const engine = async (method: string, pathname: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${daemon.discovery.port}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text() };
  };
  const status = async () => (await client.machinePlugins()).plugins.find((entry) => entry.meta.id === "data-science")!;
  const enable = (enabled: boolean) =>
    client.updateProject("project_one", { plugins: { "data-science": { enabled, settings: { python: { source: "detected", path: python, resolvedAt: 1 } } } } });

  beforeAll(async () => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "telar-ds-e2e-")));
    checkout = path.join(home, "project");
    fs.mkdirSync(checkout);
    const base = execFileSync("uv", ["python", "find", "3.12"], { encoding: "utf8" }).trim();
    execFileSync("uv", ["venv", "--python", base, path.join(checkout, ".venv")], { stdio: "ignore" });
    python = telarVenvPython(path.join(checkout, ".venv"))!;
    execFileSync("uv", ["pip", "install", "--python", python, "pandas", "matplotlib"], { stdio: "ignore" });

    daemon = await startEngine({
      models: stubModels,
      engineRoot: path.join(home, "engine"),
      pluginsDir: path.join(home, "plugins"),
      embeddedWorker: { createDriver: () => ({ capabilities: STUB_CAPABILITIES, run: async () => ({ text: "ok" }) }), pollMs: 20 },
    });
    client = new EngineClient(daemon.discovery);
    await client.registerProject({ id: "project_one", name: "One", root: checkout });
    await enable(true);
    await client.createSession({ id: "session_one", projectId: "project_one" });
    const factory: ToolFactory = (name, _description, _shape, handler) => {
      tools[name] = handler as (args: Record<string, unknown>) => Promise<ToolAnswer>;
      return { name };
    };
    const module = manifestToolModule(PluginManifest.parse(dataSciencePlugin.manifest));
    module.tools(factory, module.capability(pluginCall(client, "session_one", "data-science")));
  }, 300_000);

  afterAll(async () => {
    await daemon?.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("enabling it loads the manifest's tools, read-only tools and briefing for the session", async () => {
    const plugin = await status();
    expect(plugin.state).toBe("ready");
    expect(plugin.meta.toolPrefixes).toEqual(["ds", "notebook"]);
    expect(plugin.meta.readTools.sort()).toEqual(["ds_kernel", "ds_packages"]);
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(["ds_scratch", "ds_plot", "ds_vars", "notebook_run_cell"]));
    const session = daemon.store.records.get("session_one");
    expect(daemon.store.toolchains.enabledIds(session)).toEqual(["data-science"]);
    expect(daemon.store.pluginDoors.available("data-science", "session_one")).toBe(true);
    expect(pluginBriefings(["data-science"])).toEqual([plugin.meta.briefing!]);
    expect(JSON.parse((await tools.ds_kernel!({})).content[0]!.text)).toMatchObject({ state: "none" });
  });

  test("a cell that prints and plots answers its outputs, attaches the plot and journals the events", async () => {
    const code = "import matplotlib.pyplot as plt\nx = 42\nprint('hello from the kernel')\nplt.plot([1, 2, 3])\nplt.show()";
    const result = await call<{ ok: boolean; outputs: Output[] }>("execute", { code, producer: "e2e" });
    expect(result.ok).toBe(true);
    expect(result.outputs).toContainEqual(expect.objectContaining({ kind: "text", text: expect.stringContaining("hello from the kernel") }));
    const image = result.outputs.find((output) => output.kind === "image")!;
    expect(image.attachmentId).toBeString();

    const { attachments } = await client.attachments("session_one", { tag: "plot" });
    expect(attachments.map((attachment) => attachment.id)).toContain(image.attachmentId!);
    const bytes = await client.attachmentBytes("session_one", image.attachmentId!);
    expect(Buffer.from(bytes.data.subarray(1, 4)).toString()).toBe("PNG");

    const journal = await events();
    const states = pluginEventsIn(journal, "data-science", "kernel.state").map((event) => (event.data as { state: string }).state);
    expect(states).toEqual(expect.arrayContaining(["busy", "idle"]));
    const outputs = pluginEventsIn(journal, "data-science", "cell.output");
    expect(outputs.map((event) => (event.data as { output: Output }).output.kind)).toEqual(expect.arrayContaining(["text", "image"]));
    const plot = outputs.find((event) => (event as { note?: { attachmentId?: string } }).note?.attachmentId === image.attachmentId);
    expect(plot).toBeDefined();
    // Released iOS builds still fold the core kinds, mirrored until 2027-01-01.
    expect(journal.filter((event) => event.type === "kernel.state.changed").length).toBe(states.length);
    expect(journal.some((event) => event.type === "notebook.cell.output")).toBe(true);

    const kernel = (await status()).processes ?? [];
    expect(kernel).toContainEqual(expect.objectContaining({ key: "session_one", alive: true }));
  }, 120_000);

  test("the Data view is served and its plot verbs list, read and pin what the kernel drew", async () => {
    const plugin = await status();
    expect(plugin.meta.views).toEqual([{ id: "data", label: "Data", entry: "data.html" }]);
    const page = await engine("GET", "/v2/plugin-assets/data-science/data.html");
    expect(page.status).toBe(200);
    expect(page.text).toContain('telar.call("vars")');

    const { plots } = await call<{ plots: { id: string; producer?: string; pinned: boolean }[] }>("plots");
    expect(plots.map((plot) => plot.producer)).toContain("e2e");
    const image = await call<{ mediaType: string; dataB64: string }>("plots/image", { id: plots[0]!.id });
    expect(image.mediaType).toBe("image/png");
    expect(Buffer.from(image.dataB64, "base64").subarray(1, 4).toString()).toBe("PNG");
    await call("plots/pin", { id: plots[0]!.id, pinned: true });
    expect((await call<{ plots: { id: string; pinned: boolean }[] }>("plots")).plots.find((plot) => plot.id === plots[0]!.id)?.pinned).toBe(true);
  }, 60_000);

  test("the project's settings view shows the environment in use and its packages, and choosing by path writes it", async () => {
    const view = JSON.parse((await engine("GET", "/v2/projects/project_one/plugins/data-science/settings")).text) as { blocks: { type: string; title?: string; selected?: boolean; label?: string; text?: string; rows?: unknown[][] }[] };
    expect(view.blocks[0]).toMatchObject({ type: "prompt", label: "Ask agent to set up" });
    expect(view.blocks.find((block) => block.type === "option" && block.selected)?.title).toBe(".venv");
    expect(view.blocks.find((block) => block.type === "table")?.rows?.map((row) => row[0])).toEqual(expect.arrayContaining(["pandas", "matplotlib"]));

    const chosen = await engine("POST", "/v2/projects/project_one/plugins/data-science/use-path", { path: python });
    expect(chosen.status).toBe(200);
    const project = daemon.store.projectRegistry.get("project_one");
    expect(project.plugins?.entries["data-science"]?.settings).toMatchObject({ python: { source: "chosen", manager: "venv" } });
    const refused = await engine("POST", "/v2/projects/project_one/plugins/data-science/use-path", { path: "/nowhere/python" });
    expect(refused.status).toBe(400);
  }, 120_000);

  test("the variable inspector sees the cell's state, and a restart clears it", async () => {
    const vars = await call<{ name: string; type: string }[]>("vars");
    expect(vars).toContainEqual(expect.objectContaining({ name: "x", type: "int" }));
    expect((await tools.ds_vars!({})).content[0]!.text).toContain("x");

    await call("restart");
    expect((await call<{ name: string }[]>("vars")).map((row) => row.name)).not.toContain("x");
    const after = await tools.ds_scratch!({ code: "print(1 + 1)" });
    expect(after.content[0]!.text).toContain("2");
  }, 120_000);

  test("a notebook runs through the agent tool and keeps its outputs on disk", async () => {
    await call("notebook/edit", { path: "analysis.ipynb", edit: { kind: "create" } });
    const read = await call<{ cells: { id: string }[] }>("notebook/edit", { path: "analysis.ipynb", edit: { kind: "insert", source: "21 * 2" } });
    const cellId = read.cells.at(-1)!.id;
    const ran = await tools.notebook_run_cell!({ path: "analysis.ipynb", cellId });
    expect(ran.isError).toBeUndefined();
    const onDisk = JSON.parse(fs.readFileSync(path.join(checkout, "analysis.ipynb"), "utf8")) as { cells: { outputs?: { data?: Record<string, unknown> }[] }[] };
    expect(JSON.stringify(onDisk.cells.at(-1)!.outputs)).toContain("42");
  }, 120_000);

  test("disabling it disposes the kernel and takes its tools and session verbs away", async () => {
    await enable(false);
    await until(async () => ((await status()).processes ?? []).length === 0 || undefined, "the kernel to be disposed");

    const session = daemon.store.records.get("session_one");
    expect(daemon.store.toolchains.enabledIds(session)).toEqual([]);
    expect(pluginBriefings(daemon.store.toolchains.enabledIds(session))).toEqual([]);
    await expect(call("kernel")).rejects.toThrow("not enabled");
    const refused = await tools.ds_scratch!({ code: "print(1)" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("not enabled");
  }, 60_000);
});
