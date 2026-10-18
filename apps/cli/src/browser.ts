import fs from "node:fs";
import nodePath from "node:path";
import { browserReadiness, defaultDownload, describeStep, distroOf, engineRootFor, resolvePlaywrightCoreCli, runOnce, runSetup, setupPlan } from "@telar/engine/headless";
import type { Io } from "./io";

export const browsersPathFor = (home: string): string => nodePath.join(engineRootFor(home), "browsers");

/** Brings this host to a launchable Chromium; `dryRun` prints the steps and changes nothing. */
export async function browserSetup(options: { home: string; dryRun: boolean }, io: Io): Promise<number> {
  const browsersPath = browsersPathFor(options.home);
  const linux = process.platform === "linux";
  const readiness = await browserReadiness({ browsersPath });
  const steps = setupPlan({
    browsersPath,
    readiness,
    distro: linux ? distroOf(readFile("/etc/os-release")) : "other",
    playwrightCli: linux ? resolvePlaywrightCoreCli() : "",
  });
  if (steps.length === 0) {
    io.out(`The browser is ready: ${readiness.binary}`);
    return 0;
  }
  if (options.dryRun) {
    io.out("Would:");
    for (const step of steps) io.out(`  ${describeStep(step)}`);
    return 0;
  }
  const failure = await runSetup(steps, browsersPath, { isRoot: process.getuid?.() === 0, run: runOnce, writeFile: (file, content) => fs.writeFileSync(file, content), download: defaultDownload }, (line) => io.out(line));
  if (failure) {
    io.err(failure);
    return 1;
  }
  io.out("Done. Run `telar doctor` to confirm.");
  return 0;
}

function readFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
