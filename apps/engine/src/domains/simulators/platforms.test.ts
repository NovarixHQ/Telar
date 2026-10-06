import { expect, test } from "bun:test";
import type { ProcessRunner } from "../../platform/process/runner";
import { findXcode, hostPlatforms, hubErrors, type PlatformDeps } from "./platforms";

function deps(options: { selected: boolean; files?: string[]; apps?: string[]; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): PlatformDeps & { probes: string[][] } {
  const probes: string[][] = [];
  const run: ProcessRunner["run"] = async (file, args) => {
    probes.push([file, ...args]);
    return { code: options.selected ? 0 : 72, stdout: "", stderr: "" };
  };
  const files = new Set(options.files ?? []);
  return { platform: options.platform ?? "darwin", run, env: options.env ?? {}, home: "/Users/someone", exists: (file) => files.has(file), list: () => options.apps ?? [], probes };
}

const simctl = (app: string) => `/Applications/${app}/Contents/Developer/usr/bin/simctl`;

test("a selected developer dir with simctl is used as it is", async () => {
  const fake = deps({ selected: true, files: [simctl("Xcode.app")], apps: ["Xcode.app"] });
  expect(await findXcode(fake)).toEqual({});
  expect(fake.probes).toEqual([["xcrun", "--find", "simctl"]]);
});

test("with the command line tools selected, Xcode.app in Applications wins over other Xcodes", async () => {
  const fake = deps({ selected: false, files: [simctl("Xcode.app"), simctl("Xcode-beta.app")], apps: ["Xcode-beta.app", "Safari.app", "Xcode.app"] });
  expect(await findXcode(fake)).toEqual({ developerDir: "/Applications/Xcode.app/Contents/Developer" });
});

test("without Xcode.app, the first Xcode*.app that has simctl is used", async () => {
  const fake = deps({ selected: false, files: [simctl("Xcode_16.app")], apps: ["Xcode_15.app", "Xcode_16.app", "XcodeNotes.txt"] });
  expect(await findXcode(fake)).toEqual({ developerDir: "/Applications/Xcode_16.app/Contents/Developer" });
});

test("no Xcode at all leaves iOS unavailable with one actionable reason", async () => {
  const host = await hostPlatforms(deps({ selected: false, apps: ["Xcode.app"] }));
  expect(host.developerDir).toBeUndefined();
  expect(host.availability).toEqual([expect.objectContaining({ platform: "ios", available: false, reason: "Install Xcode to use iOS Simulators." })]);
});

test("off macOS nothing is probed", async () => {
  const fake = deps({ selected: true, platform: "linux" });
  expect((await hostPlatforms(fake)).availability).toEqual([{ platform: "ios", available: false, reason: "iOS Simulators need macOS." }]);
  expect(fake.probes).toEqual([]);
});

test("Android counts only where the hub would find its SDK", async () => {
  expect((await hostPlatforms(deps({ selected: true }))).android).toBe(false);
  expect((await hostPlatforms(deps({ selected: true, files: ["/Users/someone/Library/Android/sdk"] }))).android).toBe(true);
  expect((await hostPlatforms(deps({ selected: true, env: { ANDROID_HOME: "/opt/android" }, files: ["/opt/android"] }))).android).toBe(true);
});

test("hub errors about a missing toolchain are dropped, other errors stay", () => {
  const errors = [{ message: "[android-utils] Failed to run `avdmanager list avd`:" }, { message: "[apple-utils] Failed to run `xcrun simctl list devices --json`:" }, { message: "something else" }, {}];
  const noXcode = { availability: [{ platform: "ios" as const, available: false }], android: false };
  expect(hubErrors(errors, noXcode)).toEqual(["something else"]);
  expect(hubErrors(errors, { availability: [{ platform: "ios", available: true }], android: true })).toEqual([errors[0]!.message!, errors[1]!.message!, "something else"]);
});
