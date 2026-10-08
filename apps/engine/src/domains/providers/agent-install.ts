import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { platformTarget, type BinaryTarget, type RegistryAgent } from "./agent-catalog";

export type InstallRunner = (command: string, args: string[], options: { cwd: string; env?: Record<string, string> }) => Promise<void>;
export type InstallDeps = { fetch?: typeof fetch; run?: InstallRunner; which?: (name: string) => string | undefined; target?: string };
export type InstalledAgent = { command: string; args: string[]; env: Record<string, string> };

const INSTALL_TIMEOUT_MS = 5 * 60_000;

const realRun: InstallRunner = async (command, args, options) => {
  await promisify(execFile)(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 8_000_000 });
};

function realWhich(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function inside(dir: string, relative: string): string {
  const resolved = path.resolve(dir, relative.replace(/^\.\//, ""));
  if (path.isAbsolute(relative) || !resolved.startsWith(`${dir}${path.sep}`)) throw new Error(`the registry names a command outside the install: ${relative}`);
  return resolved;
}

async function installBinary(dir: string, target: BinaryTarget, deps: Required<Pick<InstallDeps, "fetch" | "run">>): Promise<string> {
  const response = await deps.fetch(target.archive);
  if (!response.ok) throw new Error(`the download answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (target.sha256 && crypto.createHash("sha256").update(bytes).digest("hex") !== target.sha256.toLowerCase()) {
    throw new Error("the download does not match the registry's sha256");
  }
  const name = new URL(target.archive).pathname;
  const command = inside(dir, target.cmd);
  if (/\.(tar\.gz|tgz|tar\.bz2|tbz2|zip)$/i.test(name)) {
    const archive = path.join(dir, `download${path.extname(name)}`);
    fs.writeFileSync(archive, bytes);
    await (name.endsWith(".zip") ? deps.run("unzip", ["-q", "-o", archive, "-d", dir], { cwd: dir }) : deps.run("tar", ["-xf", archive, "-C", dir], { cwd: dir }));
    fs.rmSync(archive, { force: true });
  } else {
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, bytes);
  }
  if (!fs.statSync(command, { throwIfNoEntry: false })?.isFile()) throw new Error(`the archive has no ${target.cmd}`);
  fs.chmodSync(command, 0o755);
  return command;
}

const packageName = (spec: string): string => (spec.startsWith("@") ? `@${spec.slice(1).split("@")[0]}` : spec.split("@")[0]!);

function npmBin(dir: string, spec: string): string {
  const name = packageName(spec);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "node_modules", name, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
  const base = name.split("/").pop()!;
  const bins = typeof manifest.bin === "string" ? [base] : Object.keys(manifest.bin ?? {});
  const bin = bins.includes(base) ? base : bins[0];
  if (!bin) throw new Error(`${name} has no command to run`);
  return path.join(dir, "node_modules", ".bin", bin);
}

function uvBin(binDir: string, spec: string): string {
  const base = spec.split(/[=<>~!@[ ]/)[0]!;
  const bins = fs.existsSync(binDir) ? fs.readdirSync(binDir) : [];
  const bin = bins.includes(base) ? base : bins[0];
  if (!bin) throw new Error(`${base} installed no command`);
  return path.join(binDir, bin);
}

export async function installAgent(root: string, agent: RegistryAgent, deps: InstallDeps = {}): Promise<InstalledAgent> {
  const run = deps.run ?? realRun;
  const which = deps.which ?? realWhich;
  const target = deps.target ?? platformTarget();
  const dir = path.join(root, agent.id, agent.version);
  const marker = path.join(dir, ".telar-installed.json");
  const existing = fs.existsSync(marker) ? (JSON.parse(fs.readFileSync(marker, "utf8")) as InstalledAgent) : undefined;
  if (existing) return existing;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const binary = target ? agent.distribution.binary?.[target] : undefined;
    let installed: InstalledAgent;
    if (binary) {
      installed = { command: await installBinary(dir, binary, { fetch: deps.fetch ?? fetch, run }), args: binary.args ?? [], env: binary.env ?? {} };
    } else if (agent.distribution.npx) {
      const bun = which("bun");
      if (!bun) throw new Error("Installing this agent needs Bun on the PATH.");
      const { package: spec, args = [], env = {} } = agent.distribution.npx;
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true }));
      await run(bun, ["add", "--exact", spec], { cwd: dir });
      installed = { command: npmBin(dir, spec), args, env };
    } else if (agent.distribution.uvx) {
      const uv = which("uv");
      if (!uv) throw new Error("Installing this agent needs uv on the PATH.");
      const { package: spec, args = [], env = {} } = agent.distribution.uvx;
      const binDir = path.join(dir, "bin");
      await run(uv, ["tool", "install", "--force", spec], { cwd: dir, env: { UV_TOOL_DIR: path.join(dir, "tools"), UV_TOOL_BIN_DIR: binDir } });
      installed = { command: uvBin(binDir, spec), args, env };
    } else {
      throw new Error(`${agent.name} has no build for this machine`);
    }
    fs.writeFileSync(marker, JSON.stringify(installed));
    return installed;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
