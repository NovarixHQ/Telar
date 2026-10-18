import fs from "node:fs";
import { browserReadiness, nodePtySpawner, resolveCli, signInOf } from "@telar/engine/headless";
import { browsersPathFor } from "./browser";
import { connect, readServeInfo } from "./link";
import type { Io } from "./io";
import { tailscaleStatus } from "./tailscale";

type Level = "ok" | "warn" | "fail";
export type Check = { level: Level; name: string; detail: string; hint?: string };

const PROVIDERS = [
  { id: "claude", label: "claude", login: "claude auth login" },
  { id: "codex", label: "codex", login: "codex login" },
  { id: "opencode", label: "opencode", login: "opencode auth login" },
  { id: "cursor", label: "cursor agent", login: "agent login" },
] as const;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function engineChecks(home: string): Promise<Check[]> {
  const checks: Check[] = [];
  try {
    await connect(home);
    checks.push({ level: "ok", name: "engine", detail: "reachable on loopback" });
  } catch {
    checks.push({ level: "fail", name: "engine", detail: "not running", hint: "Start it with `telar serve`." });
  }
  const info = readServeInfo(home);
  if (!info) return [...checks, { level: "warn", name: "network", detail: "no network address", hint: "`telar serve` opens one." }];
  try {
    const answer = await fetch(`http://${info.host === "0.0.0.0" || info.host === "::" ? "127.0.0.1" : info.host}:${info.port}/v2/ping`);
    checks.push({ level: answer.ok ? "ok" : "fail", name: "network", detail: `${info.host}:${info.port}${answer.ok ? "" : ` answered ${answer.status}`}` });
  } catch {
    checks.push({ level: "fail", name: "network", detail: `${info.host}:${info.port} does not answer` });
  }
  return checks;
}

// The engine's resolver logs what it finds to stdout; the report below says it better.
function quietly<T>(run: () => T): T {
  const log = console.log;
  console.log = () => undefined;
  try {
    return run();
  } finally {
    console.log = log;
  }
}

function providerChecks(): Check[] {
  return quietly(() => PROVIDERS.map(({ id, label, login }): Check => {
    const found = resolveCli(id);
    if (found.status === "missing") return { level: "warn", name: label, detail: "not installed" };
    const version = found.version ? ` ${found.version}` : "";
    const { signIn } = signInOf({ driver: id });
    if (signIn === "signed-out") {
      return { level: "warn", name: label, detail: `found${version}, not signed in`, hint: `Run \`${login}\` in a terminal on this machine; it also works over SSH.` };
    }
    return { level: "ok", name: label, detail: `found${version}${signIn === "signed-in" ? ", signed in" : ", sign-in not checkable"}` };
  }));
}

function terminalCheck(): Check {
  try {
    nodePtySpawner();
    return { level: "ok", name: "terminals", detail: "node-pty loads" };
  } catch (error) {
    return { level: "fail", name: "terminals", detail: message(error) };
  }
}

async function browserCheck(home: string): Promise<Check> {
  const readiness = await browserReadiness({ browsersPath: browsersPathFor(home) });
  const hint = "Run `telar browser setup` (add --dry-run to see the steps).";
  if (!readiness.binary) return { level: "warn", name: "browser", detail: "Chromium is not downloaded", hint };
  if (readiness.missingLibraries.length > 0) return { level: "warn", name: "browser", detail: `missing libraries: ${readiness.missingLibraries.join(", ")}`, hint };
  if (readiness.sandbox !== "ok") return { level: "warn", name: "browser", detail: `the ${readiness.sandbox === "apparmor" ? "AppArmor" : "kernel"} user-namespace restriction blocks Chromium's sandbox`, hint };
  return { level: "ok", name: "browser", detail: "Chromium is ready" };
}

async function tailscaleCheck(): Promise<Check> {
  const status = await tailscaleStatus();
  if (status.state === "missing") return { level: "ok", name: "tailscale", detail: "not installed" };
  if (status.state === "stopped") return { level: "warn", name: "tailscale", detail: `installed, ${status.backend}` };
  return { level: "ok", name: "tailscale", detail: status.dnsName };
}

export async function runChecks(home: string): Promise<Check[]> {
  const writable = (() => {
    try {
      fs.accessSync(home, fs.constants.W_OK);
      return true;
    } catch {
      return !fs.existsSync(home);
    }
  })();
  const homeCheck: Check = writable ? { level: "ok", name: "home", detail: home } : { level: "fail", name: "home", detail: `${home} is not writable` };
  return [homeCheck, ...(await engineChecks(home)), ...providerChecks(), terminalCheck(), await browserCheck(home), await tailscaleCheck()];
}

const MARK: Record<Level, string> = { ok: "ok  ", warn: "warn", fail: "fail" };

/** Prints every check; the exit code is 1 only when something that must work does not. */
export async function doctor(home: string, io: Io): Promise<number> {
  const checks = await runChecks(home);
  for (const check of checks) {
    io.out(`${MARK[check.level]}  ${check.name} — ${check.detail}`);
    if (check.hint) io.out(`      ${check.hint}`);
  }
  return checks.some((check) => check.level === "fail") ? 1 : 0;
}
