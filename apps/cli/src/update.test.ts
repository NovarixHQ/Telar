import { afterAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentVersion, installRelease, resolveVersion, switchCurrent } from "./runtime";
import { applyUpdate, restoreStore, snapshotStore, type Trial, type UpdateOps } from "./update";

const dirs: string[] = [];
const temp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "telar-update-")));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const GOOD = '#!/bin/sh\necho ready\nexec sleep 300\n';
const BROKEN = "#!/bin/sh\nexit 1\n";

function runtimeWith(versions: Record<string, string>, current: string): string {
  const runtime = temp();
  for (const [version, script] of Object.entries(versions)) {
    fs.mkdirSync(path.join(runtime, "versions", version), { recursive: true });
    fs.writeFileSync(path.join(runtime, "versions", version, "telar"), script, { mode: 0o755 });
  }
  switchCurrent(runtime, current);
  return runtime;
}

type Fake = { ops: UpdateOps; events: string[]; trialStopped: () => boolean };
function fake(runtime: string, options: { running?: boolean; sleep?: UpdateOps["sleep"]; pingAfterSwitch?: boolean } = {}): Fake {
  const events: string[] = [];
  let ready: Promise<boolean> = Promise.resolve(false);
  let exited: Promise<void> = Promise.resolve();
  let stopped = false;
  const ops: UpdateOps = {
    wasRunning: () => options.running ?? true,
    stopEngine: async () => void events.push("stop"),
    startEngine: async () => void events.push("start"),
    startTrial(binary) {
      events.push("trial");
      const child = spawn(binary, [], { stdio: ["ignore", "pipe", "ignore"] });
      ready = new Promise((resolve) => child.stdout.once("data", () => resolve(true)));
      exited = new Promise((resolve) => child.once("exit", () => resolve()));
      const trial: Trial = {
        exited,
        async stop() {
          stopped = true;
          if (child.exitCode === null) child.kill("SIGTERM");
          await exited;
        },
      };
      return trial;
    },
    ping: async () => (currentVersion(runtime) === "2.0.0" ? (options.pingAfterSwitch ?? true) : Promise.race([ready, exited.then(() => false)])),
    sleep: options.sleep ?? (() => Promise.resolve()),
    snapshot: () => (events.push("snapshot"), "snap"),
    restore: (snapshot) => void events.push(`restore ${snapshot}`),
    log: () => undefined,
  };
  return { ops, events, trialStopped: () => stopped };
}

test("a healthy new version is committed: the link moves and the old version stays for rollback", async () => {
  const runtime = runtimeWith({ "1.0.0": GOOD, "2.0.0": GOOD, "0.9.0": GOOD }, "1.0.0");
  const { ops, events, trialStopped } = fake(runtime);
  expect(await applyUpdate({ runtime, from: "1.0.0", to: "2.0.0" }, ops)).toBe("committed");
  expect(currentVersion(runtime)).toBe("2.0.0");
  expect(events).toEqual(["stop", "snapshot", "trial", "start"]);
  expect(trialStopped()).toBe(true);
  expect(fs.readdirSync(path.join(runtime, "versions")).sort()).toEqual(["1.0.0", "2.0.0"]);
});

test("a broken new version is rolled back: the link stays, the store is restored and the old engine restarts", async () => {
  const runtime = runtimeWith({ "1.0.0": GOOD, "2.0.0": BROKEN }, "1.0.0");
  const { ops, events } = fake(runtime, { sleep: () => new Promise(() => undefined) });
  expect(await applyUpdate({ runtime, from: "1.0.0", to: "2.0.0" }, ops)).toBe("rolled-back");
  expect(currentVersion(runtime)).toBe("1.0.0");
  expect(events).toEqual(["stop", "snapshot", "trial", "restore snap", "start"]);
});

test("a version that passes the trial but fails after the switch is switched back", async () => {
  const runtime = runtimeWith({ "1.0.0": GOOD, "2.0.0": GOOD }, "1.0.0");
  const { ops, events } = fake(runtime, { pingAfterSwitch: false });
  expect(await applyUpdate({ runtime, from: "1.0.0", to: "2.0.0" }, ops)).toBe("rolled-back");
  expect(currentVersion(runtime)).toBe("1.0.0");
  expect(events).toEqual(["stop", "snapshot", "trial", "start", "stop", "restore snap", "start"]);
});

test("an engine that was not running is not started by the update", async () => {
  const runtime = runtimeWith({ "1.0.0": GOOD, "2.0.0": GOOD }, "1.0.0");
  const { ops, events } = fake(runtime, { running: false });
  expect(await applyUpdate({ runtime, from: "1.0.0", to: "2.0.0" }, ops)).toBe("committed");
  expect(events).not.toContain("start");
});

test("the store snapshot restores what an upgrade changed and keeps the last three", () => {
  const home = temp();
  const root = path.join(home, "engine");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "execution.sqlite"), "v1");
  fs.writeFileSync(path.join(root, "execution.sqlite-wal"), "wal1");
  fs.writeFileSync(path.join(root, "engine.lock"), "keep");
  const snapshot = snapshotStore(home, "1.0.0", 1);
  fs.writeFileSync(path.join(root, "execution.sqlite"), "migrated");
  fs.rmSync(path.join(root, "execution.sqlite-wal"));
  restoreStore(home, snapshot);
  expect(fs.readFileSync(path.join(root, "execution.sqlite"), "utf8")).toBe("v1");
  expect(fs.readFileSync(path.join(root, "execution.sqlite-wal"), "utf8")).toBe("wal1");
  expect(fs.readFileSync(path.join(root, "engine.lock"), "utf8")).toBe("keep");
  for (const now of [2, 3, 4]) snapshotStore(home, "1.0.0", now);
  expect(fs.readdirSync(path.join(home, "backups")).length).toBe(3);
});

test("a release downloads, verifies and unpacks; a bad checksum installs nothing", async () => {
  const stage = temp();
  fs.writeFileSync(path.join(stage, "telar"), GOOD, { mode: 0o755 });
  const target = `${process.platform}-${process.arch}`;
  const archive = path.join(temp(), "a.tar.gz");
  const packed = Bun.spawnSync(["tar", "-czf", archive, "-C", stage, "."]);
  expect(packed.exitCode).toBe(0);
  const bytes = fs.readFileSync(archive);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/nightly") return new Response("3.0.0-nightly.1\n");
      if (pathname === `/3.0.0/telar-3.0.0-${target}.tar.gz`) return new Response(bytes);
      if (pathname === `/3.0.0/telar-3.0.0-${target}.tar.gz.sha256`) return new Response(`${hash}  x\n`);
      if (pathname === `/4.0.0/telar-4.0.0-${target}.tar.gz`) return new Response(bytes);
      if (pathname === `/4.0.0/telar-4.0.0-${target}.tar.gz.sha256`) return new Response("0000  x\n");
      return new Response("missing", { status: 404 });
    },
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    expect(await resolveVersion(base, "nightly", undefined)).toBe("3.0.0-nightly.1");
    const runtime = temp();
    await installRelease(runtime, base, "3.0.0", target as "linux-x64");
    expect(fs.existsSync(path.join(runtime, "versions", "3.0.0", "telar"))).toBe(true);
    await expect(installRelease(runtime, base, "4.0.0", target as "linux-x64")).rejects.toThrow("Checksum mismatch");
    expect(fs.readdirSync(path.join(runtime, "versions"))).toEqual(["3.0.0"]);
  } finally {
    await server.stop(true);
  }
});
