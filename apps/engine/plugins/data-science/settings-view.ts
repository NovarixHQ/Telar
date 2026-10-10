import type { PluginPanelBlock } from "@telar/engine-client";
import type { JobRead } from "../sdk/jobs";
import type { EnvManager, PythonEnvironment } from "./environments";
import type { PackageInfo, RequirementsSource } from "./packages";
import type { Toolchain } from "./toolchain";

type View = { blocks: PluginPanelBlock[]; refreshMs?: number };

const POLL_MS = 1500;
const STACK = ["pandas", "matplotlib", "duckdb", "pyarrow"];
const MANAGER: Record<EnvManager, string> = { venv: "uv venv", conda: "conda", system: "system Python", telar: "Telar's venv" };
const LOCATION: Record<string, string> = { project: "In this project", user: "On this machine", telar: "Telar's" };

const SETUP_PROMPT =
  "Set up Data Science for this workspace. Please inspect the project, create or choose the right Python environment, install the usual analysis stack, and confirm the notebook/ds tools can run.";

type Environment = PythonEnvironment & { path: string };

export type SettingsViewInput = {
  enabled: boolean;
  configured?: string;
  toolchain: Toolchain;
  environments: Environment[];
  requirements: RequirementsSource[];
  currentId?: string;
  packages?: { packages: (PackageInfo & { direct?: boolean })[]; error?: string };
  draft: { python?: string; stack: boolean };
  job?: { title: string; read: JobRead };
};

/** The root to store for an environment: relative when it sits in the checkout, as its interpreter path is. */
export function storedRoot(env: Environment): string {
  if (env.location !== "project") return env.root;
  const suffix = env.python.slice(env.root.length);
  return env.path.endsWith(suffix) ? env.path.slice(0, env.path.length - suffix.length) || "." : env.root;
}

function modules(env: Environment): string {
  const dists = env.preflight.dists;
  if (dists && Object.keys(dists).length > 0) return Object.entries(dists).map(([name, version]) => (version ? name : `no ${name}`)).join(", ");
  const found = env.preflight.modules;
  return found ? STACK.map((name) => (found[name] ? name : `no ${name}`)).join(", ") : "";
}

function jobBlocks(job: SettingsViewInput["job"]): View {
  if (!job) return { blocks: [] };
  const running = job.read.status === "running";
  return {
    blocks: [
      { type: "status", text: running ? `${job.title}…` : `${job.title}: ${job.read.status === "ok" ? "done" : job.read.status}`, tone: running ? "neutral" : job.read.status === "ok" ? "ok" : "error" },
      ...(job.read.error ? [{ type: "text" as const, text: job.read.error }] : []),
      { type: "log", lines: job.read.lines.slice(-200) },
    ],
    ...(running ? { refreshMs: POLL_MS } : {}),
  };
}

function toolBlocks(toolchain: Toolchain): PluginPanelBlock[] {
  const downloadable = toolchain.pythons.filter((python) => !python.installed);
  const installed = toolchain.pythons.filter((python) => python.installed);
  return [
    { type: "heading", text: "Python tools" },
    { type: "action", label: "Detect again", verb: "detect" },
    {
      type: "option",
      title: "uv",
      detail: toolchain.uv ? "Makes venvs and installs packages, fast. Also fetches Python versions." : "Not installed. Telar makes environments with uv; without it only conda environments can be created.",
      ...(toolchain.uv ? { badge: toolchain.uv.version } : { action: { label: "Install uv", verb: "bootstrap", input: { what: "uv" } } }),
    },
    {
      type: "option",
      title: "conda",
      detail: toolchain.conda ? `${toolchain.conda.flavour} at ${toolchain.conda.path}` : "Not installed. Optional — for conda environments and conda-forge packages, via Miniforge.",
      ...(toolchain.conda ? { badge: toolchain.conda.version } : { action: { label: "Install Miniforge", verb: "bootstrap", input: { what: "conda" } } }),
    },
    toolchain.uv && downloadable.length > 0
      ? {
          type: "select",
          label: "Install a Python",
          hint: installed.length ? `Installed: ${installed.map((python) => python.version).join(", ")}` : "No Python on this machine yet.",
          name: "version",
          options: [{ value: "", label: "Choose a version…" }, ...downloadable.map((python) => ({ value: python.version, label: `${python.version}${python.prerelease ? " (pre-release)" : ""}` }))],
          verb: "python",
        }
      : { type: "text", text: installed.length ? `Python installed: ${installed.map((python) => python.version).join(", ")}.` : "No Python on this machine yet. Install uv to fetch one." },
  ];
}

function environmentBlocks({ environments, currentId, configured }: SettingsViewInput): PluginPanelBlock[] {
  const cards = environments.filter((env) => env.manager !== "system" || env.id === currentId);
  const bare = environments.filter((env) => env.manager === "system" && env.id !== currentId);
  const blocks: PluginPanelBlock[] = [{ type: "heading", text: "Environments" }];
  if (cards.length === 0) blocks.push({ type: "text", text: "No Python environment found in this checkout or on this machine. Make one below — uv fetches a Python if there is none." });
  for (const env of cards) {
    const ok = env.preflight.ok;
    blocks.push({
      type: "option",
      title: env.name,
      badge: [MANAGER[env.manager], env.preflight.version].filter(Boolean).join(" · "),
      detail: `${LOCATION[env.location] ?? env.location} · ${env.reason} — ${env.root}${ok ? ` · ${modules(env)}` : ` · ${env.preflight.reason ?? "not usable"}`}`.slice(0, 500),
      selected: env.id === currentId,
      ...(ok && env.id !== currentId ? { action: { label: "Use", verb: "use", input: { path: env.path, root: storedRoot(env), manager: env.manager, source: env.manager === "telar" ? "telar" : "detected" } } } : {}),
    });
  }
  if (configured && !environments.some((env) => env.id === currentId)) {
    blocks.push({ type: "status", text: "The configured interpreter was not found", tone: "warning" }, { type: "text", text: `\`${configured}\` — pick another, or add it by path below.`, markdown: true });
  }
  if (bare.length > 0) {
    blocks.push({ type: "text", text: `Bare interpreters, to build an environment on (the kernel does not run on these): ${bare.map((env) => env.name).join(", ")}.` });
  }
  blocks.push({ type: "action", label: "Add existing", verb: "use-path", field: { name: "path", placeholder: "~/envs/analysis · /opt/miniforge3/envs/ds · /usr/local/bin/python3.12" } });
  return blocks;
}

function newEnvironmentBlocks({ toolchain, environments, draft }: SettingsViewInput): PluginPanelBlock[] {
  const minors = [...new Map(toolchain.pythons.map((python) => [python.minor, python])).values()];
  const python = draft.python ?? minors.find((p) => p.installed && !p.prerelease)?.minor ?? minors[0]?.minor ?? "3.13";
  const hasProjectVenv = environments.some((env) => env.location === "project");
  const hasTelarVenv = environments.some((env) => env.manager === "telar");
  const venv = (location: "project" | "telar", title: string, detail: string, taken: boolean): PluginPanelBlock => ({
    type: "option",
    title,
    detail: !toolchain.uv ? "Needs uv — install it above." : taken ? "Already exists — use it from the list." : detail,
    ...(toolchain.uv && !taken ? { action: { label: "Create and use", verb: "create", input: { manager: "venv", location } } } : {}),
  });
  return [
    { type: "heading", text: "New environment" },
    {
      type: "select",
      label: "Python",
      name: "python",
      value: python,
      options: minors.map((p) => ({ value: p.minor, label: `${p.minor}${p.installed ? ` · ${p.version}` : " · will download"}${p.prerelease ? " (pre-release)" : ""}` })),
      verb: "draft",
    },
    { type: "select", label: "Analysis stack", hint: STACK.join(", "), name: "stack", value: draft.stack ? "yes" : "no", options: [{ value: "yes", label: "Install it too" }, { value: "no", label: "Bare environment" }], verb: "draft" },
    venv("project", ".venv in this project", "uv venv .venv in the checkout, gitignored. Yours to keep; the agent's shells see it too.", hasProjectVenv),
    venv("telar", "Under Telar's home", "A venv Telar owns, outside the checkout. For a project that must stay untouched.", hasTelarVenv),
    toolchain.conda
      ? { type: "action", label: "Create conda env", verb: "create", input: { manager: "conda" }, field: { name: "name", placeholder: "Environment name, e.g. ds-3.12" } }
      : { type: "text", text: "conda environments need conda — install Miniforge above." },
  ];
}

function packageBlocks({ packages, requirements }: SettingsViewInput): PluginPanelBlock[] {
  if (!packages) return [];
  const blocks: PluginPanelBlock[] = [
    { type: "heading", text: "Python packages" },
    { type: "action", label: "Install", verb: "packages", field: { name: "add", placeholder: "polars seaborn scikit-learn" } },
    { type: "action", label: "Remove", verb: "packages", field: { name: "remove", placeholder: "package names" } },
  ];
  if (requirements.length > 0) {
    blocks.push({ type: "select", label: "Install what the project declares", name: "requirements", options: [{ value: "", label: "Choose a file…" }, ...requirements.map((file) => ({ value: file, label: file }))], verb: "packages" });
  }
  if (packages.error) return [...blocks, { type: "status", text: "Could not list packages", tone: "warning" }, { type: "text", text: packages.error }];
  blocks.push({ type: "table", columns: ["Package", "Version", "Declared"], rows: packages.packages.slice(0, 500).map((pkg) => [pkg.name, pkg.version, pkg.direct ? "yes" : null]) });
  return blocks;
}

/** A project's Data Science settings: the tools, the environment its kernel runs in, and that environment's packages. */
export function settingsView(input: SettingsViewInput): View {
  const blocks: PluginPanelBlock[] = [{ type: "prompt", label: "Ask agent to set up", text: SETUP_PROMPT }];
  if (input.enabled && !input.configured) blocks.push({ type: "status", text: "No environment selected yet", tone: "warning" });
  const job = jobBlocks(input.job);
  blocks.push(...toolBlocks(input.toolchain), ...job.blocks, ...environmentBlocks(input), ...newEnvironmentBlocks(input), ...packageBlocks(input));
  return { blocks, ...(job.refreshMs ? { refreshMs: job.refreshMs } : {}) };
}
