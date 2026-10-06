import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeHub, fakeRunner } from "../../../test/fake-simulator-hub";
import { processRunner } from "../../platform/process/runner";
import { SimulatorHub } from "./hub";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup(options: { ready?: boolean; ps?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-hub-"));
  roots.push(root);
  const fake = fakeRunner(options.ps === undefined ? {} : { ps: options.ps });
  let clock = 0;
  const sleeps: number[] = [];
  const hub = new SimulatorHub({
    root,
    runner: fake.runner,
    fetch: fakeHub([], options.ready === undefined ? {} : { ready: options.ready }).fetch,
    env: () => ({ PATH: "/usr/bin", TELAR_HOME: undefined }),
    reservePort: async () => 4321,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return { root, hub, sleeps, ...fake, advance: (ms: number) => (clock += ms) };
}

test("starts the hub under node, bound to loopback, and answers its origin once ready", async () => {
  const { hub, starts } = setup();
  expect(await hub.start("/hub/cli.mjs")).toBe("http://127.0.0.1:4321");
  expect(starts[0]!.file).toBe("node");
  expect(starts[0]!.args).toEqual(["/hub/cli.mjs", "--port", "4321", "--host", "127.0.0.1", "--hide-sidebar", "--hide-boot-device"]);
  expect(starts[0]!.options?.env?.NO_COLOR).toBe("1");
  expect(hub.status()).toEqual({ state: "ready" });
});

test("concurrent starts share one child", async () => {
  const { hub, starts } = setup();
  await Promise.all([hub.start("/hub/cli.mjs"), hub.start("/hub/cli.mjs")]);
  expect(starts).toHaveLength(1);
});

test("a hub that never answers readyz is stopped and reported as failed", async () => {
  const { hub, starts } = setup({ ready: false });
  await expect(hub.start("/hub/cli.mjs")).rejects.toThrow("did not become ready within 30 seconds");
  expect(await starts[0]!.handle.exited).toBeNull();
  expect(hub.status().state).toBe("failed");
});

test("a hub that dies is restarted, backing off while it keeps dying young", async () => {
  const { hub, starts, started, sleeps } = setup();
  await hub.start("/hub/cli.mjs");
  starts[0]!.exit();
  await started(2);
  await hub.start("/hub/cli.mjs");
  starts[1]!.exit();
  await started(3);
  await hub.start("/hub/cli.mjs");
  expect(starts).toHaveLength(3);
  expect(sleeps.filter((ms) => ms >= 1_000)).toEqual([1_000, 2_000]);
  await hub.stop();
});

test("a hub that ran a minute restarts at once", async () => {
  const { hub, starts, started, sleeps, advance } = setup();
  await hub.start("/hub/cli.mjs");
  advance(60_000);
  starts[0]!.exit();
  await started(2);
  expect(sleeps.at(-1)).toBe(0);
  await hub.stop();
});

test("stop ends the child and nothing restarts it", async () => {
  const { hub, starts } = setup();
  await hub.start("/hub/cli.mjs");
  await hub.stop();
  expect(await starts[0]!.handle.exited).toBeNull();
  expect(starts).toHaveLength(1);
  expect(hub.origin()).toBeUndefined();
});

test("a stale hub from an engine that died is stopped only when its command line is ours", async () => {
  const stale = processRunner.start("sleep", ["60"]);
  const other = processRunner.start("sleep", ["60"]);
  try {
    const ours = setup({ ps: "node /hub/cli.mjs --port 4000" });
    fs.mkdirSync(path.join(ours.root, "simulators"));
    fs.writeFileSync(path.join(ours.root, "simulators", "hub.json"), JSON.stringify({ pid: stale.pid, port: 4000, entryPath: "/hub/cli.mjs" }));
    await ours.hub.start("/hub/cli.mjs");
    expect(await stale.exited).toBeNull();
    await ours.hub.stop();

    const theirs = setup({ ps: "/usr/bin/something-else" });
    fs.mkdirSync(path.join(theirs.root, "simulators"));
    fs.writeFileSync(path.join(theirs.root, "simulators", "hub.json"), JSON.stringify({ pid: other.pid, port: 4000, entryPath: "/hub/cli.mjs" }));
    await theirs.hub.start("/hub/cli.mjs");
    expect(() => process.kill(other.pid!, 0)).not.toThrow();
    await theirs.hub.stop();
  } finally {
    stale.stop();
    other.stop();
  }
});
