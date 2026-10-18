import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { UsageError } from "./io";

const run = promisify(execFile);

const PLACEHOLDER_BASE = "https://downloads.example.invalid/telar";
export type Channel = "stable" | "nightly";

function target(platform = process.platform, arch = process.arch): string {
  const name = `${platform}-${arch}`;
  if (name === "linux-x64" || name === "linux-arm64" || name === "darwin-arm64") return name;
  throw new UsageError(`There is no telar build for ${platform} ${arch}.`);
}

const versionsDir = (runtime: string): string => path.join(runtime, "versions");
export const versionDir = (runtime: string, version: string): string => path.join(versionsDir(runtime), version);

export function currentVersion(runtime: string): string | undefined {
  try {
    return path.basename(fs.readlinkSync(path.join(runtime, "current")));
  } catch {
    return undefined;
  }
}

export function switchCurrent(runtime: string, version: string): void {
  const link = path.join(runtime, "current");
  const staged = `${link}.${process.pid}`;
  fs.rmSync(staged, { force: true });
  fs.symlinkSync(path.join("versions", version), staged);
  fs.renameSync(staged, link);
}

export function pruneVersions(runtime: string, keep: string[]): void {
  for (const name of fs.readdirSync(versionsDir(runtime))) {
    if (!keep.includes(name)) fs.rmSync(versionDir(runtime, name), { recursive: true, force: true });
  }
}

export function downloadBase(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const base = (flag ?? env.TELAR_DOWNLOAD_BASE ?? PLACEHOLDER_BASE).replace(/\/+$/, "");
  if (base === PLACEHOLDER_BASE) throw new UsageError("No download host is configured; pass --base <url> or set TELAR_DOWNLOAD_BASE.");
  return base;
}

async function fetchOk(url: string): Promise<Response> {
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
  return answer;
}

const text = async (url: string): Promise<string> => (await fetchOk(url)).text();

export async function resolveVersion(base: string, channel: Channel, version: string | undefined): Promise<string> {
  const resolved = version ?? (await text(`${base}/${channel}`)).trim();
  if (!/^[A-Za-z0-9._+-]+$/.test(resolved)) throw new Error(`Invalid version: ${resolved}`);
  return resolved;
}

export async function installRelease(runtime: string, base: string, version: string, platformTarget = target()): Promise<string> {
  const archive = `telar-${version}-${platformTarget}.tar.gz`;
  const url = `${base}/${version}/${archive}`;
  const bytes = Buffer.from(await (await fetchOk(url)).arrayBuffer());
  const expected = (await text(`${url}.sha256`)).trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (expected !== actual) throw new Error(`Checksum mismatch for ${archive}.`);
  fs.mkdirSync(versionsDir(runtime), { recursive: true });
  const stage = path.join(versionsDir(runtime), `.${version}.${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage);
  try {
    const file = path.join(stage, archive);
    fs.writeFileSync(file, bytes);
    await run("tar", ["-xzf", file, "-C", stage]);
    fs.rmSync(file);
    fs.accessSync(path.join(stage, "telar"), fs.constants.X_OK);
    fs.rmSync(versionDir(runtime, version), { recursive: true, force: true });
    fs.renameSync(stage, versionDir(runtime, version));
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return versionDir(runtime, version);
}
