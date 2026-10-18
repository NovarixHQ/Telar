import fs from "node:fs";
import path from "node:path";
import { installBrowser, runOnce, type RunOnce } from "./transport";

export type Distro = "debian" | "fedora" | "other";

export type BrowserReadiness = {
  binary: string | null;
  missingLibraries: string[];
  sandbox: "ok" | "apparmor" | "userns";
};

export type SetupStep =
  | { kind: "download"; title: string }
  | { kind: "command"; title: string; command: string[]; root: boolean }
  | { kind: "file"; title: string; path: string; content: string; root: true };

const APPARMOR_RESTRICT = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
const UNPRIVILEGED_USERNS = "/proc/sys/kernel/unprivileged_userns_clone";
export const APPARMOR_PROFILE_PATH = "/etc/apparmor.d/telar-chromium";

const FEDORA_PACKAGES = ["nss", "nspr", "atk", "at-spi2-atk", "cups-libs", "libdrm", "libxkbcommon", "libXcomposite", "libXdamage", "libXfixes", "libXrandr", "mesa-libgbm", "pango", "alsa-lib"];

const BINARIES = ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell"];

const read = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

export function distroOf(osRelease: string | null): Distro {
  const ids = (osRelease ?? "")
    .split("\n")
    .filter((line) => line.startsWith("ID=") || line.startsWith("ID_LIKE="))
    .flatMap((line) => line.slice(line.indexOf("=") + 1).replaceAll('"', "").split(/\s+/));
  if (ids.some((id) => id === "debian" || id === "ubuntu")) return "debian";
  if (ids.some((id) => id === "fedora" || id === "rhel" || id === "centos")) return "fedora";
  return "other";
}

export function findChromium(browsersPath: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(browsersPath).sort().reverse();
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.startsWith("chromium")) continue;
    const root = path.join(browsersPath, entry);
    if (!fs.existsSync(path.join(root, "INSTALLATION_COMPLETE"))) continue;
    const binary = BINARIES.map((relative) => path.join(root, relative)).find((candidate) => fs.existsSync(candidate));
    if (binary) return binary;
  }
  return null;
}

export const missingLibraries = (lddOutput: string): string[] =>
  [...new Set([...lddOutput.matchAll(/^\s*(\S+)\s+=>\s+not found/gm)].map((match) => match[1]!))];

export async function browserReadiness(options: { browsersPath: string; platform?: NodeJS.Platform; run?: RunOnce }): Promise<BrowserReadiness> {
  const binary = findChromium(options.browsersPath);
  if ((options.platform ?? process.platform) !== "linux") return { binary, missingLibraries: [], sandbox: "ok" };
  let libraries: string[] = [];
  if (binary) {
    const run = options.run ?? runOnce;
    libraries = missingLibraries((await run("ldd", [binary]).catch(() => ({ code: 1, output: "" }))).output);
  }
  const sandbox = read(APPARMOR_RESTRICT)?.trim() === "1" ? "apparmor" : read(UNPRIVILEGED_USERNS)?.trim() === "0" ? "userns" : "ok";
  return { binary, missingLibraries: libraries, sandbox };
}

const profile = (browsersPath: string): string =>
  `abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile telar-chromium ${path.join(browsersPath, "**", "{chrome,chrome-headless-shell,headless_shell}")} flags=(unconfined) {\n  userns,\n  include if exists <local/telar-chromium>\n}\n`;

export function setupPlan(options: { browsersPath: string; readiness: BrowserReadiness; distro: Distro; playwrightCli: string }): SetupStep[] {
  const { readiness, distro, browsersPath } = options;
  const steps: SetupStep[] = [];
  if (!readiness.binary) steps.push({ kind: "download", title: "Download Chromium" });
  if (!readiness.binary || readiness.missingLibraries.length > 0) {
    if (distro === "debian") {
      steps.push({ kind: "command", title: "Install Chromium's system libraries", command: [process.execPath, options.playwrightCli, "install-deps", "chromium"], root: true });
    } else if (distro === "fedora") {
      steps.push({ kind: "command", title: "Install Chromium's system libraries", command: ["dnf", "install", "-y", ...FEDORA_PACKAGES], root: true });
    }
  }
  if (readiness.sandbox === "apparmor") {
    steps.push({ kind: "file", title: "Allow Telar's Chromium to use user namespaces (AppArmor)", path: APPARMOR_PROFILE_PATH, content: profile(browsersPath), root: true });
    steps.push({ kind: "command", title: "Load the AppArmor profile", command: ["apparmor_parser", "-r", APPARMOR_PROFILE_PATH], root: true });
  } else if (readiness.sandbox === "userns") {
    steps.push({ kind: "command", title: "Allow unprivileged user namespaces", command: ["sysctl", "-w", "kernel.unprivileged_userns_clone=1"], root: true });
  }
  return steps;
}

export const describeStep = (step: SetupStep): string => {
  if (step.kind === "download") return step.title;
  if (step.kind === "command") return `${step.title}: ${step.root ? "sudo " : ""}${step.command.join(" ")}`;
  return `${step.title}: write ${step.path}`;
};

export type SetupEffects = {
  isRoot: boolean;
  run: RunOnce;
  writeFile: (file: string, content: string) => void;
  download: (browsersPath: string) => Promise<string>;
};

export async function runSetup(steps: SetupStep[], browsersPath: string, effects: SetupEffects, report: (line: string) => void): Promise<string | null> {
  for (const step of steps) {
    report(describeStep(step));
    try {
      if (step.kind === "download") {
        await effects.download(browsersPath);
      } else if (step.kind === "file") {
        if (effects.isRoot) effects.writeFile(step.path, step.content);
        else {
          const written = await effects.run("sudo", ["tee", step.path], undefined, step.content);
          if (written.code !== 0) return written.output.trim() || `could not write ${step.path}`;
        }
      } else {
        const [command, ...args] = step.root && !effects.isRoot ? ["sudo", ...step.command] : step.command;
        const result = await effects.run(command!, args);
        if (result.code !== 0) return result.output.trim() || `${step.title} exited with code ${result.code}`;
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return null;
}

export const defaultDownload = (browsersPath: string) => installBrowser({ browsersPath });
