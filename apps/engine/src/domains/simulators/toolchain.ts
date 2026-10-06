import fs from "node:fs";
import path from "node:path";
import type { ProcessRunner } from "../../platform/process/runner";

const HUB_PACKAGE = "expo-device-hub";
export const HUB_VERSION = "0.12.0";

const SENTINEL = ".install-complete";
const INSTALL_TIMEOUT_MS = 10 * 60_000;

const toolDir = (root: string) => path.join(root, "tools", HUB_PACKAGE);
const installDir = (root: string, version: string) => path.join(toolDir(root), version);
export const hubEntry = (root: string, version = HUB_VERSION) =>
  path.join(installDir(root, version), "node_modules", HUB_PACKAGE, "dist", "server", "cli.mjs");

/** Never carries npm's output: it can hold a registry URL with credentials in it. */
class HubInstallError extends Error {
  constructor(
    readonly step: "npm install" | "verify" | "publish",
    readonly exitCode?: number | null,
  ) {
    super(`Installing ${HUB_PACKAGE} ${HUB_VERSION} failed while running ${step}${exitCode != null ? ` (exit code ${exitCode})` : ""}.`);
    this.name = "HubInstallError";
  }
}

function isComplete(root: string, version: string): boolean {
  try {
    return fs.readFileSync(path.join(installDir(root, version), SENTINEL), "utf8") === version && fs.existsSync(hubEntry(root, version));
  } catch {
    return false;
  }
}

export function installedHubVersions(root: string): string[] {
  try {
    return fs.readdirSync(toolDir(root)).filter((name) => !name.startsWith(".") && isComplete(root, name)).sort();
  } catch {
    return [];
  }
}

export class HubToolchain {
  private inFlight?: Promise<string>;

  constructor(private readonly deps: { root: string; runner: ProcessRunner; env: () => NodeJS.ProcessEnv }) {}

  installed(): boolean {
    return isComplete(this.deps.root, HUB_VERSION);
  }

  install(): Promise<string> {
    if (this.installed()) return Promise.resolve(hubEntry(this.deps.root));
    this.inFlight ??= this.run().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  private async run(): Promise<string> {
    const { root, runner } = this.deps;
    const target = installDir(root, HUB_VERSION);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(toolDir(root), { recursive: true });
    const staging = fs.mkdtempSync(path.join(toolDir(root), ".staging-"));
    try {
      const result = await runner.run("npm", ["install", "--prefix", staging, "--no-fund", "--no-audit", `${HUB_PACKAGE}@${HUB_VERSION}`], {
        env: this.deps.env(),
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (result.code !== 0) throw new HubInstallError("npm install", result.code);
      if (!fs.existsSync(path.join(staging, "node_modules", HUB_PACKAGE, "dist", "server", "cli.mjs"))) throw new HubInstallError("verify");
      fs.writeFileSync(path.join(staging, SENTINEL), HUB_VERSION);
      try {
        fs.renameSync(staging, target);
      } catch {
        if (!this.installed()) throw new HubInstallError("publish");
      }
      return hubEntry(root);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
