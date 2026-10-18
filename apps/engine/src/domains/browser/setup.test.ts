import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserReadiness, distroOf, findChromium, missingLibraries, runSetup, setupPlan, type BrowserReadiness, type SetupEffects } from "./setup";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-browsers-"));
  dirs.push(dir);
  return dir;
};
const install = (root: string, complete = true) => {
  const binary = path.join(root, "chromium-1200", "chrome-linux64", "chrome");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, "");
  if (complete) fs.writeFileSync(path.join(root, "chromium-1200", "INSTALLATION_COMPLETE"), "");
  return binary;
};
const ready: BrowserReadiness = { binary: "/b/chrome", missingLibraries: [], sandbox: "ok" };

test("a finished Chromium download is found, an interrupted one is not", () => {
  const root = tempDir();
  install(root, false);
  expect(findChromium(root)).toBeNull();
  const binary = install(root);
  expect(findChromium(root)).toBe(binary);
  expect(findChromium(path.join(root, "nope"))).toBeNull();
});

test("ldd output names the libraries that are missing once each", () => {
  const output = "\tlibnss3.so => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x1)\n\tlibnss3.so => not found\n\tlibasound.so.2 => not found\n";
  expect(missingLibraries(output)).toEqual(["libnss3.so", "libasound.so.2"]);
});

test("readiness reports the binary and its missing libraries", async () => {
  const root = tempDir();
  const binary = install(root);
  const run = async (command: string, args: readonly string[]) => ({ code: 1, output: command === "ldd" && args[0] === binary ? "\tlibgbm.so.1 => not found\n" : "" });
  const readiness = await browserReadiness({ browsersPath: root, platform: "linux", run });
  expect(readiness.binary).toBe(binary);
  expect(readiness.missingLibraries).toEqual(["libgbm.so.1"]);
  expect(await browserReadiness({ browsersPath: root, platform: "darwin", run })).toEqual({ binary, missingLibraries: [], sandbox: "ok" });
});

test("os-release maps to a package manager family", () => {
  expect(distroOf('ID=ubuntu\nID_LIKE=debian\n')).toBe("debian");
  expect(distroOf('ID="rocky"\nID_LIKE="rhel centos fedora"\n')).toBe("fedora");
  expect(distroOf("ID=alpine\n")).toBe("other");
  expect(distroOf(null)).toBe("other");
});

const plan = (readiness: BrowserReadiness, distro: "debian" | "fedora" | "other") => setupPlan({ browsersPath: "/home/u/engine/browsers", readiness, distro, playwrightCli: "/pw/cli.js" });

test("a ready host needs nothing", () => {
  expect(plan(ready, "debian")).toEqual([]);
});

test("a fresh Ubuntu host downloads, installs libraries and loosens AppArmor for Telar's Chromium only", () => {
  const steps = plan({ binary: null, missingLibraries: [], sandbox: "apparmor" }, "debian");
  expect(steps.map((step) => step.kind)).toEqual(["download", "command", "file", "command"]);
  expect(steps[1]).toMatchObject({ command: [process.execPath, "/pw/cli.js", "install-deps", "chromium"], root: true });
  const profile = steps[2];
  expect(profile.kind === "file" && profile.content).toContain("/home/u/engine/browsers/**/{chrome,chrome-headless-shell,headless_shell}");
  expect(profile.kind === "file" && profile.content).toContain("userns,");
  expect(steps[3]).toMatchObject({ command: ["apparmor_parser", "-r", "/etc/apparmor.d/telar-chromium"] });
});

test("Fedora installs libraries with dnf; an unknown distro gets only what is portable", () => {
  const missing: BrowserReadiness = { binary: "/b/chrome", missingLibraries: ["libnss3.so"], sandbox: "ok" };
  const fedora = plan(missing, "fedora");
  expect(fedora).toHaveLength(1);
  expect(fedora[0]).toMatchObject({ command: expect.arrayContaining(["dnf", "install", "-y", "nss"]) });
  expect(plan(missing, "other")).toEqual([]);
  expect(plan({ ...missing, sandbox: "userns" }, "other")).toMatchObject([{ command: ["sysctl", "-w", "kernel.unprivileged_userns_clone=1"] }]);
});

const effects = (isRoot: boolean, failOn?: string) => {
  const calls: string[] = [];
  const value: SetupEffects = {
    isRoot,
    run: async (command, args, _env, input) => {
      calls.push([command, ...args, ...(input ? [`<${input.length}b`] : [])].join(" "));
      return { code: failOn && args.includes(failOn) ? 1 : 0, output: failOn ? "boom" : "" };
    },
    writeFile: (file) => void calls.push(`write ${file}`),
    download: async () => {
      calls.push("download");
      return "";
    },
  };
  return { calls, value };
};

test("setup asks sudo for root steps only when not root", async () => {
  const steps = plan({ binary: null, missingLibraries: [], sandbox: "apparmor" }, "debian");
  const user = effects(false);
  expect(await runSetup(steps, "/b", user.value, () => undefined)).toBeNull();
  expect(user.calls[0]).toBe("download");
  expect(user.calls[1]).toStartWith("sudo ");
  expect(user.calls[2]).toStartWith("sudo tee /etc/apparmor.d/telar-chromium <");
  const root = effects(true);
  await runSetup(steps, "/b", root.value, () => undefined);
  expect(root.calls.filter((call) => call.startsWith("sudo"))).toEqual([]);
  expect(root.calls).toContain("write /etc/apparmor.d/telar-chromium");
});

test("setup stops at the first failing step and says why", async () => {
  const steps = plan({ binary: null, missingLibraries: [], sandbox: "apparmor" }, "debian");
  const failing = effects(true, "install-deps");
  expect(await runSetup(steps, "/b", failing.value, () => undefined)).toBe("boom");
  expect(failing.calls).toEqual(["download", `${process.execPath} /pw/cli.js install-deps chromium`]);
});
