import type { PluginPanelBlock } from "@telar/engine-client";
import type { JobRead } from "../sdk/jobs";
import type { ManagedTectonicStatus } from "./managed";
import { detectedDistribution, type LatexMachineSettings, type LatexSettings } from "./settings";
import type { LatexToolchain, TexliveDistribution } from "./toolchain";
import type { CompileStatus, LatexPackagesAnswer } from "./types";

type View = { blocks: PluginPanelBlock[]; refreshMs?: number };

const POLL_MS = 1500;
const ENGINES = ["pdflatex", "lualatex", "xelatex"] as const;
const FLAVOUR: Record<TexliveDistribution["flavour"], string> = { mactex: "MacTeX", tinytex: "TinyTeX", texlive: "TeX Live" };

const distName = (dist: TexliveDistribution) => `${FLAVOUR[dist.flavour]}${dist.year ? ` ${dist.year}` : ""}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function jobBlocks(job: { title: string; read: JobRead } | undefined): View {
  if (!job) return { blocks: [] };
  const running = job.read.status === "running";
  const tone = running ? "neutral" : job.read.status === "ok" ? "ok" : "error";
  return {
    blocks: [
      { type: "status", text: running ? `${job.title}…` : job.read.status === "ok" ? `${job.title}: done` : `${job.title}: ${job.read.status}`, tone },
      ...(job.read.error ? [{ type: "text" as const, text: job.read.error }] : []),
      { type: "log", lines: job.read.lines.slice(-200) },
    ],
    ...(running ? { refreshMs: POLL_MS } : {}),
  };
}

/** The session's panel: compile, the last compile's status, its problems and the log. */
export function compileView(status: CompileStatus | { status: "never" }, mainFile: string | undefined): View {
  const last = status.status === "never" ? undefined : status;
  const blocks: PluginPanelBlock[] = [
    { type: "action", label: "Compile", verb: "compile", field: { name: "path", placeholder: mainFile ? `Default: ${mainFile}` : "report/main.tex" } },
  ];
  if (!last) {
    blocks.push({ type: "text", text: "Nothing has been compiled in this session yet. Type a .tex path and press Compile, or ask the agent; its `latex_compile` lands here too.", markdown: true });
    return { blocks };
  }
  const label = last.status === "ok" ? "Compiled" : last.status === "failed" ? "Failed" : last.status === "running" ? "Compiling" : "Cancelled";
  const tone = last.status === "ok" ? "ok" : last.status === "failed" ? "error" : "neutral";
  blocks.push({ type: "status", text: last.path ? `${label} · ${last.path}` : label, tone });
  if (last.error) blocks.push({ type: "text", text: last.error });
  if (last.pdfPath) blocks.push({ type: "file", label: "Open PDF", path: last.pdfPath });
  if (last.diagnostics.length > 0) {
    blocks.push({
      type: "issues",
      items: last.diagnostics.map((d) => ({
        severity: d.severity,
        message: d.message,
        ...(d.file ? { file: d.file } : {}),
        ...(d.line ? { line: d.line } : {}),
        ...(d.suggestion ? { detail: d.suggestion } : {}),
      })),
    });
    const errors = last.diagnostics.filter((d) => d.severity === "error").length;
    blocks.push({ type: "text", text: `${plural(errors, "error")}, ${plural(last.diagnostics.length - errors, "warning")}.` });
  } else if (last.status === "ok") {
    blocks.push({ type: "text", text: "Clean compile — no errors, no warnings." });
  }
  blocks.push({ type: "log", title: "Log tail", lines: last.logTail.length ? last.logTail : ["(empty)"], collapsed: true });
  return { blocks };
}

function inherited(machine: LatexMachineSettings, toolchain: LatexToolchain): string {
  const mac = machine.toolchain;
  const texlive = mac?.kind === "texlive" ? toolchain.texlive.find((dist) => dist.binDir === mac.path) : undefined;
  const detected = detectedDistribution(toolchain);
  const label =
    mac?.kind === "managed" ? "Telar (managed)"
    : mac?.kind === "tectonic" ? "Tectonic"
    : mac?.kind === "texlive" ? (texlive ? distName(texlive) : "TeX Live")
    : toolchain.managed?.installed ? "Telar (managed)"
    : detected?.kind === "texlive" ? distName(detected.dist)
    : detected?.kind === "tectonic" ? "Tectonic"
    : "none";
  return `Inherit (${label})`;
}

export type ProjectViewInput = {
  enabled: boolean;
  settings: LatexSettings;
  machine: LatexMachineSettings;
  toolchain: LatexToolchain;
  mainCandidates: string[];
  packages?: LatexPackagesAnswer;
  job?: { title: string; read: JobRead };
};

/** A project's LaTeX settings: what to compile, with what, and the packages it carries. */
export function projectView({ enabled, settings, machine, toolchain, mainCandidates, packages, job }: ProjectViewInput): View {
  const chosen = settings.toolchain;
  const tectonic = toolchain.tectonic;
  const blocks: PluginPanelBlock[] = [
    {
      type: "prompt",
      label: "Ask agent to set up",
      text: "Set up LaTeX for this workspace. Please inspect the .tex files, choose or install the right TeX toolchain, identify the report entry points, and compile one document to confirm it works.",
    },
  ];
  if (mainCandidates.length > 0) {
    blocks.push({
      type: "select",
      label: "Default document",
      hint: "Used only when you press Compile without choosing a file. Agents can still compile any report by path.",
      name: "mainFile",
      ...(settings.mainFile ? { value: settings.mainFile } : {}),
      options: [{ value: "", label: "No default" }, ...mainCandidates.map((file) => ({ value: file, label: file }))],
      verb: "document",
    });
  } else {
    blocks.push(
      { type: "text", text: "Default document: no .tex with \\documentclass found in the top folders — type a path, or ask the agent to inspect deeper." },
      { type: "action", label: "Set", verb: "document", field: { name: "mainFile", placeholder: "paper/main.tex", ...(settings.mainFile ? { value: settings.mainFile } : {}) } },
    );
  }
  if (chosen?.kind === "texlive") {
    blocks.push({
      type: "select",
      label: "Engine",
      hint: "What latexmk drives. pdflatex unless the document needs system fonts (xelatex, lualatex).",
      name: "engine",
      ...(chosen.engine ? { value: chosen.engine } : {}),
      options: [{ value: "", label: `Inherit (${machine.engine ?? "pdflatex"})` }, ...ENGINES.map((engine) => ({ value: engine, label: engine }))],
      verb: "engine",
    });
  }
  blocks.push(
    { type: "heading", text: "Distributions" },
    { type: "action", label: "Detect again", verb: "detect" },
    {
      type: "option",
      title: inherited(machine, toolchain),
      detail: "This computer's default, set on the Plugins pane.",
      selected: enabled && !chosen,
      action: { label: "Use", verb: "use", input: { kind: "inherit" } },
    },
    {
      type: "option",
      title: "Tectonic",
      detail: tectonic ? `${tectonic.path} — packages download automatically on first use` : "A single self-contained engine. Packages download automatically — no tlmgr, no 5 GB install.",
      ...(tectonic ? { badge: tectonic.version } : {}),
      selected: enabled && chosen?.kind === "tectonic",
      action: tectonic ? { label: "Use", verb: "use", input: { kind: "tectonic", path: tectonic.path } } : { label: "Install", verb: "bootstrap", input: { what: "tectonic" } },
    },
    ...toolchain.texlive.map((dist): PluginPanelBlock => ({
      type: "option",
      title: distName(dist),
      detail: `${dist.binDir} — ${ENGINES.filter((engine) => dist[engine]).join(", ") || "no engines found"}${dist.tlmgr ? ", tlmgr" : ", no tlmgr"}`,
      ...(dist.latexmk ? { badge: `latexmk ${dist.latexmk.version}` } : {}),
      selected: enabled && chosen?.kind === "texlive" && chosen.path === dist.binDir,
      action: { label: "Use", verb: "use", input: { kind: "texlive", path: dist.binDir } },
    })),
  );
  if (!toolchain.texlive.some((dist) => dist.flavour === "tinytex")) {
    blocks.push({
      type: "option",
      title: "TinyTeX",
      detail: "A ~150 MB user-owned TeX Live with a writable tlmgr — the managed choice when Tectonic's engine is not enough.",
      action: { label: "Install", verb: "bootstrap", input: { what: "tinytex" } },
    });
  }
  const running = jobBlocks(job);
  blocks.push(...running.blocks);
  if (enabled && chosen) blocks.push(...packageBlocks(chosen.kind === "texlive", packages));
  return { blocks, ...(running.refreshMs ? { refreshMs: running.refreshMs } : {}) };
}

function packageBlocks(texlive: boolean, packages: LatexPackagesAnswer | undefined): PluginPanelBlock[] {
  const blocks: PluginPanelBlock[] = [{ type: "heading", text: "TeX packages" }];
  if (!texlive) return [...blocks, { type: "text", text: "Tectonic fetches packages automatically the first time a document uses them." }];
  blocks.push({ type: "action", label: "Install", verb: "install", field: { name: "add", placeholder: "tlmgr package names — siunitx booktabs…" } });
  if (packages?.mode === "unavailable") blocks.push({ type: "status", text: packages.reason, tone: "warning" });
  if (packages?.mode === "managed") {
    blocks.push({ type: "table", columns: ["Package", "Revision", "Description"], rows: packages.packages.map((pkg) => [pkg.name, pkg.revision ?? null, pkg.description ?? null]) });
  }
  return blocks;
}

/** This Mac's default distribution, including Telar's own Tectonic. */
export function machineView(machine: LatexMachineSettings, toolchain: LatexToolchain, managed: ManagedTectonicStatus, job?: { title: string; read: JobRead }): View {
  const chosen = machine.toolchain;
  const blocks: PluginPanelBlock[] = [{ type: "text", text: "TeX distribution: what this computer compiles with when a project has not chosen its own." }];
  blocks.push({
    type: "option",
    title: "Telar (managed)",
    detail: managed.installed
      ? `Tectonic ${managed.version}, downloaded by Telar — a project opened on any computer compiles with it, with no TeX installed.`
      : managed.supported
        ? `Tectonic ${managed.version}, about 20 MB. Telar keeps it in its own folder, so LaTeX works on a computer with no TeX on it.`
        : "Telar has no managed Tectonic for this platform yet.",
    selected: chosen?.kind === "managed",
    ...(managed.installing ? { badge: "Installing…" } : {}),
    ...(managed.installed
      ? { action: { label: "Use", verb: "default", input: { kind: "managed" } } }
      : managed.supported && !managed.installing
        ? { action: { label: "Install", verb: "managed" } }
        : {}),
  });
  if (managed.error) blocks.push({ type: "status", text: managed.error, tone: "error" });
  const found = [
    ...(toolchain.tectonic ? [{ kind: "tectonic" as const, path: toolchain.tectonic.path, title: "Tectonic" }] : []),
    ...toolchain.texlive.map((dist) => ({ kind: "texlive" as const, path: dist.binDir, title: distName(dist) })),
  ];
  if (found.length === 0) {
    blocks.push({ type: "text", text: "No other TeX install found. Telar's own Tectonic above needs nothing installed; TeX Live and a system Tectonic are found here when they are present." });
  }
  for (const choice of found) {
    blocks.push({
      type: "option",
      title: choice.title,
      detail: choice.path,
      selected: chosen?.kind === choice.kind && chosen.path === choice.path,
      action: { label: "Use", verb: "default", input: { kind: choice.kind, path: choice.path } },
    });
  }
  const running = jobBlocks(job);
  blocks.push(...running.blocks);
  const refreshMs = managed.installing ? POLL_MS : running.refreshMs;
  return { blocks, ...(refreshMs ? { refreshMs } : {}) };
}
