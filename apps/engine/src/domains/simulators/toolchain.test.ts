import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeRunner } from "../../../test/fake-simulator-hub";
import { AGENT_DEVICE, HUB, HUB_VERSION, hubEntry, installedVersions, NpmToolchain, toolBinDir } from "./toolchain";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup(overrides?: Parameters<typeof fakeRunner>[0]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-hub-toolchain-"));
  roots.push(root);
  const fake = fakeRunner(overrides);
  return { root, ...fake, toolchain: new NpmToolchain(HUB, { root, runner: fake.runner, env: () => ({ PATH: "/usr/bin" }) }) };
}

test("installs the pinned hub under tools/<name>/<version> and marks it complete", async () => {
  const { root, runs, toolchain } = setup();
  expect(await toolchain.install()).toBe(hubEntry(root));
  expect(hubEntry(root)).toBe(path.join(root, "tools", "expo-device-hub", HUB_VERSION, "node_modules", "expo-device-hub", "dist", "server", "cli.mjs"));
  expect(runs[0]!.args).toContain(`expo-device-hub@${HUB_VERSION}`);
  expect(installedVersions(root, HUB)).toEqual([HUB_VERSION]);
  expect(fs.readdirSync(path.join(root, "tools", "expo-device-hub"))).toEqual([HUB_VERSION]);
});

test("concurrent installs share one npm run, and an installed hub runs none", async () => {
  const { runs, toolchain } = setup();
  await Promise.all([toolchain.install(), toolchain.install()]);
  await toolchain.install();
  expect(runs.filter((run) => run.file === "npm")).toHaveLength(1);
});

test("a failed install leaves nothing behind and never repeats npm's output", async () => {
  const { root, toolchain } = setup({ npm: { code: 1, stdout: "", stderr: "GET https://private:credential@registry.example/ 401" } });
  const failure = await toolchain.install().catch((error: Error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(`Installing expo-device-hub ${HUB_VERSION} failed while running npm install (exit code 1).`);
  expect(fs.readdirSync(path.join(root, "tools", "expo-device-hub"))).toEqual([]);
  expect(installedVersions(root, HUB)).toEqual([]);
});

test("a version directory without its completion marker is not installed", async () => {
  const { root, toolchain } = setup();
  fs.mkdirSync(path.dirname(hubEntry(root)), { recursive: true });
  fs.writeFileSync(hubEntry(root), "");
  expect(toolchain.installed()).toBe(false);
  expect(installedVersions(root, HUB)).toEqual([]);
});

test("agent-device installs pinned beside the hub, with its command on a bin directory", async () => {
  const { root, runs, runner } = setup();
  await new NpmToolchain(AGENT_DEVICE, { root, runner, env: () => ({}) }).install();
  expect(runs[0]!.args).toContain(`agent-device@${AGENT_DEVICE.version}`);
  expect(installedVersions(root, AGENT_DEVICE)).toEqual([AGENT_DEVICE.version]);
  expect(toolBinDir(root, AGENT_DEVICE)).toBe(path.join(root, "tools", "agent-device", AGENT_DEVICE.version, "node_modules", ".bin"));
});
