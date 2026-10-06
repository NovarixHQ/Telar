import fs from "node:fs";
import path from "node:path";
import type { ProcessRunner } from "../../platform/process/runner";

export type NpmTool = { name: string; version: string; entry: string };

export const HUB: NpmTool = { name: "expo-device-hub", version: "0.12.0", entry: "dist/server/cli.mjs" };
export const HUB_VERSION = HUB.version;
export const AGENT_DEVICE: NpmTool = { name: "agent-device", version: "0.21.12", entry: "bin/agent-device.mjs" };

const SENTINEL = ".install-complete";
const INSTALL_TIMEOUT_MS = 10 * 60_000;

const toolDir = (root: string, tool: NpmTool) => path.join(root, "tools", tool.name);
const installDir = (root: string, tool: NpmTool, version = tool.version) => path.join(toolDir(root, tool), version);
const packageDir = (root: string, tool: NpmTool, version = tool.version) => path.join(installDir(root, tool, version), "node_modules", tool.name);
const toolEntry = (root: string, tool: NpmTool, version = tool.version) => path.join(packageDir(root, tool, version), tool.entry);
export const hubEntry = (root: string, version = HUB.version) => toolEntry(root, HUB, version);
export const toolBinDir = (root: string, tool: NpmTool) => path.join(installDir(root, tool), "node_modules", ".bin");

export function hubHelpers(root: string): { axSettings?: string; serveSimCli?: string } {
  const dist = path.join(packageDir(root, HUB), "vendor", "serve-sim", "dist");
  const axSettings = path.join(dist, "simax", "serve-sim-ax-settings");
  const serveSimCli = path.join(dist, "serve-sim.js");
  return { ...(fs.existsSync(axSettings) ? { axSettings } : {}), ...(fs.existsSync(serveSimCli) ? { serveSimCli } : {}) };
}

/** Never carries npm's output: it can hold a registry URL with credentials in it. */
class ToolInstallError extends Error {
  constructor(tool: NpmTool, step: "npm install" | "verify" | "publish", exitCode?: number | null) {
    super(`Installing ${tool.name} ${tool.version} failed while running ${step}${exitCode != null ? ` (exit code ${exitCode})` : ""}.`);
    this.name = "ToolInstallError";
  }
}

function isComplete(root: string, tool: NpmTool, version: string): boolean {
  try {
    return fs.readFileSync(path.join(installDir(root, tool, version), SENTINEL), "utf8") === version && fs.existsSync(toolEntry(root, tool, version));
  } catch {
    return false;
  }
}

export function installedVersions(root: string, tool: NpmTool): string[] {
  try {
    return fs.readdirSync(toolDir(root, tool)).filter((name) => !name.startsWith(".") && isComplete(root, tool, name)).sort();
  } catch {
    return [];
  }
}

export class NpmToolchain {
  private inFlight?: Promise<string>;

  constructor(
    private readonly tool: NpmTool,
    private readonly deps: { root: string; runner: ProcessRunner; env: () => NodeJS.ProcessEnv },
  ) {}

  installed(): boolean {
    return isComplete(this.deps.root, this.tool, this.tool.version);
  }

  install(): Promise<string> {
    if (this.installed()) return Promise.resolve(toolEntry(this.deps.root, this.tool));
    this.inFlight ??= this.run().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  private async run(): Promise<string> {
    const { tool } = this;
    const { root, runner } = this.deps;
    const target = installDir(root, tool);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(toolDir(root, tool), { recursive: true });
    const staging = fs.mkdtempSync(path.join(toolDir(root, tool), ".staging-"));
    try {
      const result = await runner.run("npm", ["install", "--prefix", staging, "--no-fund", "--no-audit", `${tool.name}@${tool.version}`], {
        env: this.deps.env(),
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (result.code !== 0) throw new ToolInstallError(tool, "npm install", result.code);
      if (!fs.existsSync(path.join(staging, "node_modules", tool.name, tool.entry))) throw new ToolInstallError(tool, "verify");
      fs.writeFileSync(path.join(staging, SENTINEL), tool.version);
      try {
        fs.renameSync(staging, target);
      } catch {
        if (!this.installed()) throw new ToolInstallError(tool, "publish");
      }
      return toolEntry(root, tool);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
