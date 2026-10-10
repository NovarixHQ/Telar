import fs from "node:fs";
import { z } from "zod";
import type { ResolvedLatex } from "./compile";
import type { LatexToolchain, TexliveDistribution } from "./toolchain";

export const LatexEngine = z.enum(["pdflatex", "lualatex", "xelatex"]);
export type LatexEngine = z.infer<typeof LatexEngine>;

/** `managed` is Telar's own Tectonic and carries no path, so a version bump never strands a stored choice. */
const LatexDistribution = z.object({
  kind: z.enum(["tectonic", "texlive", "managed"]),
  path: z.string().min(1).optional(),
  engine: LatexEngine.optional(),
});

const LatexDistributionWrite = LatexDistribution.refine(
  (choice) => choice.kind === "managed" || (choice.path !== undefined && choice.path.length > 0),
  { message: "a tectonic or texlive distribution needs the path it lives at", path: ["path"] },
);

/** `widget: "view"` leaves a field to the plugin's own settings view rather than a generated row. */
export const LatexSettings = z.object({ toolchain: LatexDistribution.optional(), mainFile: z.string().min(1).optional().meta({ widget: "view" }) });
export type LatexSettings = z.infer<typeof LatexSettings>;

const machineFields = {
  toolchain: LatexDistribution.optional(),
  engine: LatexEngine.optional().meta({
    title: "Default engine",
    description: "What latexmk drives on a TeX Live install. Tectonic is XeTeX inside and ignores it.",
    icon: "settings",
    labels: { pdflatex: "pdfLaTeX", lualatex: "LuaLaTeX", xelatex: "XeLaTeX" },
  }),
  autoInstallPackages: z.boolean().optional().meta({
    title: "Install missing packages automatically",
    description:
      "When a TeX Live compile fails on a package it does not have, install it with tlmgr and compile once more. Tectonic already fetches packages by itself.",
    icon: "package-plus",
  }),
};

const LatexMachineSettings = z.object(machineFields);
export type LatexMachineSettings = z.infer<typeof LatexMachineSettings>;

export const LatexMachineSettingsWrite = z.strictObject({ ...machineFields, toolchain: LatexDistributionWrite.optional() });

export function projectSettings(raw: Record<string, unknown>): LatexSettings {
  const parsed = LatexSettings.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function machineSettings(raw: Record<string, unknown>): LatexMachineSettings {
  const parsed = LatexMachineSettings.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** The project's choice, then the Mac's default, then Telar's managed Tectonic; each must exist on disk. */
export function resolveLatex(project: LatexSettings, machine: LatexMachineSettings, managedPath: string | undefined): ResolvedLatex | undefined {
  for (const choice of [project.toolchain, machine.toolchain]) {
    if (!choice) continue;
    const binPath = choice.kind === "managed" ? managedPath : choice.path;
    if (!binPath || !fs.existsSync(binPath)) continue;
    const engine = choice.engine ?? machine.engine;
    return {
      kind: choice.kind === "managed" ? "tectonic" : choice.kind,
      binPath,
      ...(engine ? { engine } : {}),
      ...(project.mainFile ? { mainFile: project.mainFile } : {}),
      ...(machine.autoInstallPackages ? { autoInstallPackages: true } : {}),
    };
  }
  if (!managedPath) return undefined;
  return { kind: "tectonic", binPath: managedPath, ...(project.mainFile ? { mainFile: project.mainFile } : {}) };
}

export function detectedDistribution(toolchain: LatexToolchain): { kind: "texlive"; dist: TexliveDistribution } | { kind: "tectonic"; path: string } | undefined {
  const dist = toolchain.texlive.find((candidate) => candidate.latexmk);
  if (dist) return { kind: "texlive", dist };
  return toolchain.tectonic ? { kind: "tectonic", path: toolchain.tectonic.path } : undefined;
}

export function resolveDetected(project: LatexSettings, machine: LatexMachineSettings, toolchain: LatexToolchain): ResolvedLatex | undefined {
  const detected = detectedDistribution(toolchain);
  if (!detected) return undefined;
  const engine = detected.kind === "texlive" ? machine.engine : undefined;
  return {
    kind: detected.kind,
    binPath: detected.kind === "texlive" ? detected.dist.binDir : detected.path,
    ...(engine ? { engine } : {}),
    ...(project.mainFile ? { mainFile: project.mainFile } : {}),
    ...(machine.autoInstallPackages && detected.kind === "texlive" ? { autoInstallPackages: true } : {}),
  };
}
