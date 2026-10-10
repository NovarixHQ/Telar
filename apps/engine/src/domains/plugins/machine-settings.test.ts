/**
 * The Mac-wide defaults a project inherits: Data Science's interpreter resolves through them, and every plugin's
 * are validated by its own machine schema and survive a restart. LaTeX's fallback chain is `plugins/latex/settings.test.ts`.
 */
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, dataScienceMachineSettings, machineSettings, type ProjectPlugins } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { resolveInterpreter } from "../../../plugins/data-science/settings";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-machine-settings-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/** A project with LaTeX and data science on, and no toolchain of its own. */
async function ready() {
  const daemon = await startEngine({ models: stubModels, engineRoot: root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.registerProject({ id: "project_one", name: "One", root: root() });
  // @ts-expect-error deprecated alias the engine still accepts
  await client.updateProject("project_one", { latex: { enabled: true, mainFile: "paper.tex" } });
  await client.createSession({ id: "session_one", projectId: "project_one" });
  return { daemon, client, store: daemon.store };
}

const machine = (daemon: EngineDaemon, plugins: Record<string, { enabled: boolean; settings?: Record<string, unknown> } | null>) =>
  fetch(`http://127.0.0.1:${daemon.discovery.port}/v2/plugins`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
    body: JSON.stringify({ plugins }),
  });

// ── data science defaults ───────────────────────────────────────────────────

const interpreter = (store: EngineDaemon["store"], project: Record<string, unknown> = {}) =>
  resolveInterpreter({ cwd: os.tmpdir(), settings: project, machine: dataScienceMachineSettings(store.toolchains.machine()) });

test("the MAC'S DEFAULT PYTHON runs a project that chose none", async () => {
  const { daemon, client, store } = await ready();
  // @ts-expect-error deprecated alias the engine still accepts
  await client.updateProject("project_one", { dataScience: { enabled: true } });
  expect(interpreter(store)).toMatchObject({ refusal: expect.stringContaining("has no Python interpreter") });

  await machine(daemon, { "data-science": { enabled: true, settings: { python: "/bin/echo" } } });
  expect(interpreter(store)).toEqual({ pythonPath: "/bin/echo" });
});

test("a project's own interpreter still wins, and a Mac default that is gone resolves to nothing", async () => {
  const { daemon, store } = await ready();
  await machine(daemon, { "data-science": { enabled: true, settings: { python: "/bin/echo" } } });
  expect(interpreter(store, { python: { source: "chosen", path: "/bin/ls", resolvedAt: Date.now() } })).toEqual({ pythonPath: "/bin/ls" });

  await machine(daemon, { "data-science": { enabled: true, settings: { python: "/nowhere/python3" } } });
  expect(interpreter(store)).toEqual({ refusal: "data science's Python interpreter is not on disk: /nowhere/python3" });
});

test("the machine ceiling and a project's own switch both win over a machine DEFAULT", async () => {
  const { daemon } = await ready();
  const status = () =>
    fetch(`http://127.0.0.1:${daemon.discovery.port}/v2/sessions/session_one/plugins/latex/status`, {
      method: "POST",
      headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
      body: "{}",
    }).then((response) => response.json() as Promise<{ error?: { message: string } }>);
  expect((await status()).error).toBeUndefined();
  await machine(daemon, { latex: { enabled: false, settings: { toolchain: { kind: "managed" } } } });
  expect((await status()).error?.message).toContain("turned off for this computer");
  await machine(daemon, { latex: { enabled: true, settings: { toolchain: { kind: "managed" } } } });
  await new EngineClient(daemon.discovery).updateProject("project_one", { plugins: { latex: null } });
  expect((await status()).error?.message).toContain("not enabled");
});

// ── the round trip ──────────────────────────────────────────────────────────

test("the new settings ROUND-TRIP: written, read back, and survive a restart", async () => {
  const { daemon } = await ready();
  const latex = { toolchain: { kind: "managed" }, engine: "xelatex", autoInstallPackages: true };
  const ds = { python: "/bin/echo", packages: ["pandas", "matplotlib"] };
  expect((await machine(daemon, { latex: { enabled: true, settings: latex }, "data-science": { enabled: true, settings: ds } })).status).toBe(200);

  const answer = await fetch(`http://127.0.0.1:${daemon.discovery.port}/v2/plugins`, {
    headers: { authorization: `Bearer ${daemon.discovery.token}` },
  });
  const body = (await answer.json()) as { machine: ProjectPlugins };
  expect(machineSettings(body.machine, "latex")).toEqual({ toolchain: { kind: "managed" }, engine: "xelatex", autoInstallPackages: true });
  expect(dataScienceMachineSettings(body.machine)).toEqual({ python: "/bin/echo", packages: ["pandas", "matplotlib"] });

  const home = daemon.store.paths.root;
  await daemon.close();
  daemons.length = 0;
  const restarted = await startEngine({ models: stubModels, engineRoot: home });
  daemons.push(restarted);
  expect(machineSettings(restarted.store.toolchains.machine(), "latex").engine).toBe("xelatex");
  expect(dataScienceMachineSettings(restarted.store.toolchains.machine()).packages).toEqual(["pandas", "matplotlib"]);
});

test("the MACHINE schema validates the machine arm — a project-only field is refused", async () => {
  const { daemon } = await ready();
  // `mainFile` is a fact about a checkout. Before the machine arm had its own
  // schema it reused the project one, so this was silently accepted and stored
  // somewhere nothing would ever read it.
  const bad = await machine(daemon, { latex: { enabled: true, settings: { mainFile: "paper.tex" } } });
  expect(bad.status).toBe(400);
  expect(JSON.stringify(await bad.json())).toContain("not valid for latex");

  // …and so is a nonsense value in a field that IS machine-scoped.
  const worse = await machine(daemon, { latex: { enabled: true, settings: { engine: "troff" } } });
  expect(worse.status).toBe(400);

  const ds = await machine(daemon, { "data-science": { enabled: true, settings: { packages: "pandas" } } });
  expect(ds.status).toBe(400);
});

test("A DEFAULT PACKAGE THAT COULD BE READ AS A FLAG IS REFUSED AT THE WRITE", async () => {
  // The list ends up in argv for uv or conda. Refusing it here is so the person
  // is told while they are looking at the field; `planEnvironment` checks again
  // at creation, because a blob on disk may predate this.
  const { daemon } = await ready();
  expect((await machine(daemon, { "data-science": { enabled: true, settings: { packages: ["--index-url=https://evil.example"] } } })).status).toBe(400);
  expect((await machine(daemon, { "data-science": { enabled: true, settings: { packages: ["polars", "-r reqs.txt"] } } })).status).toBe(400);
  // A pinned requirement is ordinary and must not be caught by the same net.
  expect((await machine(daemon, { "data-science": { enabled: true, settings: { packages: ["polars>=1.0", "httpx[http2]"] } } })).status).toBe(200);
});

test("THE STORE PASSES THIS MAC'S DEFAULTS INTO ENVIRONMENT CREATION", async () => {
  // The package check runs before the uv check, so a bad default refuses on its own message on any machine.
  // Written to disk because the write arm refuses it, and a value that predates that check is the case here.
  const { daemon, client } = await ready();
  // @ts-expect-error deprecated alias the engine still accepts
  await client.updateProject("project_one", { dataScience: { enabled: true } });
  fs.writeFileSync(
    daemon.store.paths.machinePlugins,
    JSON.stringify({ version: 1, entries: { "data-science": { enabled: true, settings: { packages: ["--index-url=https://evil.example"] } } } }),
  );
  // The lenient reader keeps it — which is the point: it must reach the check
  // rather than being silently dropped on the way.
  expect(dataScienceMachineSettings(daemon.store.toolchains.machine()).packages).toEqual(["--index-url=https://evil.example"]);

  const refused = await client
    .dataScienceCreateEnvironment("project_one", { manager: "venv", location: "telar", python: "3.13" })
    .then(() => undefined)
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  expect(refused).toContain("not a package requirement");
  expect(refused).toContain("Settings › Plugins");
});

test("ONLY `managed` may omit a path — the other kinds name a place", async () => {
  // A `texlive` default with nowhere to be resolves to nothing, which in the
  // pane reads as a setting that saved and then did not work. `managed` is the
  // exception because the ENGINE supplies its place.
  const { daemon } = await ready();
  expect((await machine(daemon, { latex: { enabled: true, settings: { toolchain: { kind: "texlive" } } } })).status).toBe(400);
  expect((await machine(daemon, { latex: { enabled: true, settings: { toolchain: { kind: "tectonic" } } } })).status).toBe(400);
  expect((await machine(daemon, { latex: { enabled: true, settings: { toolchain: { kind: "managed" } } } })).status).toBe(200);
});
