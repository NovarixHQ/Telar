import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobRead, JobRunner } from "../sdk/jobs";
import { adoptBinaryDir } from "../sdk/probe";
import { type LatexBootstrapRequest, planLatexBootstrap } from "./bootstrap";
import { ManagedTectonic, type ManagedTectonicStatus } from "./managed";
import { listTexPackages, TECTONIC_PACKAGES_NOTE, texInstallSteps, texRemoveSteps } from "./packages";
import type { LatexSettings } from "./settings";
import { findLatexBinary, latexToolchainStatus, type LatexToolchain } from "./toolchain";
import type { LatexPackagesAnswer } from "./types";

const MAX_MAIN_CANDIDATES = 50;
const TOOLCHAIN_CACHE_MS = 5_000;

/** `.tex` files carrying `\documentclass`, two levels deep and capped: a monorepo has thousands of files that are not a main file. */
export function mainFileCandidates(root: string): string[] {
  const candidates: string[] = [];
  const scan = (dir: string, depth: number) => {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (candidates.length >= MAX_MAIN_CANDIDATES) return;
      if (name.startsWith(".") || name === "node_modules") continue;
      const file = path.join(dir, name);
      let stat: fs.Stats;
      try { stat = fs.statSync(file); } catch { continue; }
      if (stat.isDirectory()) {
        if (depth > 0) scan(file, depth - 1);
        continue;
      }
      if (!/\.tex$/i.test(name) || stat.size > 2 * 1024 * 1024) continue;
      try {
        if (fs.readFileSync(file, "utf8").includes("\\documentclass")) candidates.push(path.relative(root, file));
      } catch { /* unreadable is not a candidate */ }
    }
  };
  scan(root, 2);
  return candidates.sort();
}

type JobHandle = { jobId: string; title: string };

/** TeX probes, Telar's own Tectonic, and the install jobs the settings views follow. */
export class LatexSetup {
  private cache?: { until: number; value: Promise<LatexToolchain> };
  readonly managed: ManagedTectonic;
  /** The last install each settings view started: `machine`, or a project id. */
  private readonly lastJobs = new Map<string, JobHandle>();

  constructor(
    private readonly jobs: JobRunner,
    private readonly now: () => number,
    engineRoot: string,
  ) {
    this.managed = new ManagedTectonic({ root: engineRoot });
  }

  /** Cached briefly because each answer is several spawns; the managed Tectonic's status is one `stat` and rides outside. */
  toolchain(fresh = false): Promise<LatexToolchain> {
    if (fresh || !this.cache || this.now() >= this.cache.until) {
      const value = latexToolchainStatus();
      this.cache = { until: this.now() + TOOLCHAIN_CACHE_MS, value };
      void value.catch(() => { this.cache = undefined; });
    }
    return this.cache.value.then((toolchain) => ({ ...toolchain, managed: this.managedStatus() }));
  }

  managedStatus(): ManagedTectonicStatus {
    return this.managed.status();
  }

  async installManaged(): Promise<ManagedTectonicStatus> {
    const status = await this.managed.install();
    this.cache = undefined;
    return status;
  }

  /** Adopts the binary's directory on success so the next compile finds it without a restart. */
  async bootstrap(request: LatexBootstrapRequest, scope = "machine"): Promise<{ jobId: string }> {
    const toolchain = await this.toolchain(true);
    let plan;
    try {
      plan = planLatexBootstrap(request, toolchain);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    if (request.what === "tectonic" && !toolchain.brew) {
      try { fs.mkdirSync(path.join(os.homedir(), ".local", "bin"), { recursive: true }); } catch { /* the installer will say so */ }
    }
    const expect = plan.expectBinary;
    const started = this.jobs.start({
      kind: `bootstrap:${request.what}`,
      lock: `bootstrap:${request.what}`,
      steps: plan.steps,
      onDone: () => {
        this.cache = undefined;
        const found = findLatexBinary(expect);
        if (!found) throw new Error(`${expect} was installed but cannot be found — open a new terminal, check your PATH, then detect again`);
        adoptBinaryDir(found);
        return { binary: found };
      },
    });
    this.lastJobs.set(scope, { jobId: started.jobId, title: request.what === "tectonic" ? "Installing Tectonic" : "Installing TinyTeX" });
    return started;
  }

  private async texlive(settings: LatexSettings) {
    if (!settings.toolchain) throw new Error("this project has no TeX toolchain configured");
    if (settings.toolchain.kind !== "texlive") return { tectonic: true as const };
    const toolchain = await this.toolchain();
    const configured = settings.toolchain.path;
    return { tectonic: false as const, dist: toolchain.texlive.find((candidate) => candidate.binDir === configured) ?? toolchain.texlive[0] };
  }

  async packages(settings: LatexSettings): Promise<LatexPackagesAnswer> {
    const texlive = await this.texlive(settings);
    if (texlive.tectonic) return { mode: "automatic", note: TECTONIC_PACKAGES_NOTE };
    if (!texlive.dist) return { mode: "unavailable", reason: "the configured TeX Live was not found on this machine" };
    return listTexPackages(texlive.dist);
  }

  /** tlmgr install/remove; Tectonic projects are refused, and the agent's tool says why. */
  async install(projectId: string, settings: LatexSettings, input: { add?: string[]; remove?: string[] }): Promise<{ jobId: string }> {
    const texlive = await this.texlive(settings);
    if (texlive.tectonic) throw new Error(TECTONIC_PACKAGES_NOTE);
    const dist = texlive.dist;
    if (!dist) throw new Error("the configured TeX Live was not found on this machine");
    let steps;
    try {
      steps = [...(input.remove?.length ? texRemoveSteps(dist, input.remove) : []), ...(input.add?.length ? texInstallSteps(dist, input.add) : [])];
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    if (!steps.length) throw new Error("nothing to install or remove");
    const started = this.jobs.start({ kind: "tex-packages", lock: `${dist.binDir}:tex-packages`, steps });
    this.lastJobs.set(projectId, { jobId: started.jobId, title: `Installing ${(input.add ?? []).join(", ") || "packages"}` });
    return started;
  }

  /** The install a settings view last started, while the runner still remembers it. */
  lastJob(scope: string): (JobHandle & { read: JobRead }) | undefined {
    const handle = this.lastJobs.get(scope);
    if (!handle) return undefined;
    try {
      return { ...handle, read: this.jobs.read(handle.jobId) };
    } catch {
      this.lastJobs.delete(scope);
      return undefined;
    }
  }

  job(jobId: string, after?: number): JobRead {
    return this.jobs.read(jobId, after);
  }

  cancelJob(jobId: string): void {
    this.jobs.cancel(jobId);
  }
}
