import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SimulatorPlatformAvailability } from "@telar/engine-client";
import type { ProcessRunner } from "../../platform/process/runner";

export type PlatformDeps = {
  platform: NodeJS.Platform;
  run: ProcessRunner["run"];
  env: NodeJS.ProcessEnv;
  home?: string;
  exists?: (file: string) => boolean;
  list?: (dir: string) => string[];
};

export type HostPlatforms = { availability: SimulatorPlatformAvailability[]; developerDir?: string; android: boolean };

const APPLICATIONS = "/Applications";
const NO_XCODE: SimulatorPlatformAvailability = {
  platform: "ios",
  available: false,
  reason: "Install Xcode to use iOS Simulators.",
  detail: "Telar uses the Xcode in Applications even when xcode-select points at the command line tools. After installing it, turn simulators off and on again.",
};

const listDir = (dir: string) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** Undefined when no Xcode has simctl; a developerDir when the selected one lacks it and an Xcode in Applications has it. */
export async function findXcode(deps: PlatformDeps): Promise<{ developerDir?: string } | undefined> {
  const { code } = await deps.run("xcrun", ["--find", "simctl"], { env: deps.env, timeoutMs: 10_000 });
  if (code === 0) return {};
  const exists = deps.exists ?? fs.existsSync;
  const others = (deps.list ?? listDir)(APPLICATIONS)
    .filter((name) => name !== "Xcode.app" && /^Xcode.*\.app$/.test(name))
    .sort();
  for (const app of ["Xcode.app", ...others]) {
    const developerDir = path.join(APPLICATIONS, app, "Contents", "Developer");
    if (exists(path.join(developerDir, "usr", "bin", "simctl"))) return { developerDir };
  }
  return undefined;
}

/** Mirrors where the hub looks for the Android SDK. */
function hasAndroidSdk(deps: PlatformDeps): boolean {
  const root = deps.env.ANDROID_HOME || deps.env.ANDROID_SDK_ROOT || path.join(deps.home ?? os.homedir(), "Library", "Android", "sdk");
  return (deps.exists ?? fs.existsSync)(root);
}

export async function hostPlatforms(deps: PlatformDeps): Promise<HostPlatforms> {
  const android = hasAndroidSdk(deps);
  if (deps.platform !== "darwin") return { availability: [{ platform: "ios", available: false, reason: "iOS Simulators need macOS." }], android };
  const xcode = await findXcode(deps);
  if (!xcode) return { availability: [NO_XCODE], android };
  return { availability: [{ platform: "ios", available: true }], android, ...xcode };
}

/** Missing-toolchain errors from the hub repeat what availability already says. */
export function hubErrors(errors: ReadonlyArray<{ message?: string }>, host: HostPlatforms): string[] {
  const ios = host.availability.some((entry) => entry.platform === "ios" && entry.available);
  return errors.flatMap(({ message }) => {
    if (!message || (!host.android && message.startsWith("[android-utils]")) || (!ios && message.startsWith("[apple-utils]"))) return [];
    return [message];
  });
}
