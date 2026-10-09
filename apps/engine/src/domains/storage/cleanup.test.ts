import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CLEANUP_POLICY, mountRootsFor } from "@telar/engine-client";
import { VolumeGate } from "../../platform/fs/volume-gate";
import { isRotated, planWorktreeCleanup, sweepCheckouts, sweepLogs, type PlannedRelease, type SweepOutcome } from "./cleanup";
import { EngineStore } from "../../state";
import { until } from "../../../test/wait";
import { worktreeReady } from "../../../test/worktree-ready";

const roots: string[] = [];
const tmp = (prefix: string): string => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const OFF = { ...DEFAULT_CLEANUP_POLICY, settledDays: null };

test("off plans nothing, and a released checkout is never planned twice", () => {
  const now = 40 * DAY;
  const sessions = [
    { sessionId: "old", path: "/w/old", archived: false, released: false, settledAt: 0 },
    { sessionId: "gone", path: "/w/gone", archived: false, released: true, settledAt: 0 },
  ];
  expect(planWorktreeCleanup(sessions, OFF, now)).toEqual([]);
  expect(planWorktreeCleanup(sessions, DEFAULT_CLEANUP_POLICY, now)).toEqual([{ sessionId: "old", path: "/w/old", reason: "settled" }]);
});

test("by default a session settled or archived three days is planned for release, and a live or recent one is not", () => {
  const now = 40 * DAY;
  const sessions = [
    { sessionId: "long", path: "/w/long", archived: false, released: false, settledAt: 36 * DAY },
    { sessionId: "recent", path: "/w/recent", archived: false, released: false, settledAt: 38 * DAY },
    { sessionId: "live", path: "/w/live", archived: false, released: false },
    { sessionId: "archived", path: "/w/archived", archived: true, released: false, settledAt: 30 * DAY },
    { sessionId: "just-archived", path: "/w/just-archived", archived: true, released: false, settledAt: 39 * DAY },
  ];
  expect(planWorktreeCleanup(sessions, DEFAULT_CLEANUP_POLICY, now)).toEqual([
    { sessionId: "long", path: "/w/long", reason: "settled" },
    { sessionId: "archived", path: "/w/archived", reason: "archived" },
  ]);
});

test("a volume that is missing or stops answering is skipped whole, and the others are still swept", async () => {
  const mounts = mountRootsFor(process.platform)[0] ?? "/mnt";
  const at = (volume: string, name: string) => path.join(mounts, volume, name);
  const plan: PlannedRelease[] = [at("Slow", "a"), at("Slow", "b"), at("Gone", "c"), at("Fast", "d"), at("Fast", "e")].map((target, index) => ({ sessionId: `s${index}`, path: target, reason: "settled" }));
  const asked: string[] = [];
  const swept = await sweepCheckouts(plan, {
    concurrency: 1,
    timeoutMs: 5,
    gate: new VolumeGate(async (mount) => (mount.endsWith("Gone") ? "missing" : "ok")),
    sizeOf: (target) => (target === at("Fast", "d") ? 100 : undefined),
    processes: async () => new Set(),
    tried: new Map(),
    release: (item) => {
      asked.push(item.path);
      return item.path.includes("Slow") ? new Promise<SweepOutcome>(() => {}) : Promise.resolve("released");
    },
  });
  expect(asked).toEqual([at("Slow", "a"), at("Fast", "d"), at("Fast", "e")]);
  expect(swept).toEqual({ released: 2, skipped: 3, freedBytes: 100 });
});

test("a sweep tries at most its limit, the next one starts with those not yet tried, and the batch shares one process listing", async () => {
  const plan: PlannedRelease[] = ["a", "b", "c", "d", "e"].map((name) => ({ sessionId: name, path: path.join(os.tmpdir(), name), reason: "settled" }));
  const tried = new Map<string, number>();
  const listings: (readonly string[])[] = [];
  const sweep = async () => {
    const asked: string[] = [];
    await sweepCheckouts(plan, {
      limit: 2,
      tried,
      gate: new VolumeGate(async () => "ok"),
      sizeOf: () => undefined,
      processes: async (checkouts) => {
        listings.push(checkouts);
        return new Set();
      },
      release: async (item, processes) => {
        asked.push(item.sessionId);
        await processes();
        return "skipped";
      },
    });
    return asked.sort();
  };
  expect(await sweep()).toEqual(["a", "b"]);
  expect(await sweep()).toEqual(["c", "d"]);
  expect(await sweep()).toEqual(["a", "e"]);
  expect(listings.map((checkouts) => checkouts.length)).toEqual([2, 2, 2]);
});

test("only rotated logs and the given setup logs older than the window are deleted", async () => {
  const directory = tmp("telar-cleanup-logs-");
  const now = Date.now();
  const old = (now - 40 * DAY) / 1000;
  for (const name of ["worker.jsonl", "worker.jsonl.1", "engine.log.2.gz", "notes.txt"]) {
    fs.writeFileSync(path.join(directory, name), "x".repeat(10));
    fs.utimesSync(path.join(directory, name), old, old);
  }
  fs.writeFileSync(path.join(directory, "fresh.log.1"), "new");
  const setupLog = path.join(directory, "setup.log");
  fs.writeFileSync(setupLog, "done");
  fs.utimesSync(setupLog, old, old);

  expect(isRotated("worker.jsonl")).toBe(false);
  const swept = await sweepLogs({ logDirectories: [directory], setupLogs: [setupLog], days: 30, now });
  expect(swept.count).toBe(3);
  expect(fs.readdirSync(directory).sort()).toEqual(["fresh.log.1", "notes.txt", "worker.jsonl"]);
});

async function setup() {
  const origin = tmp("telar-cleanup-origin-");
  git(origin, "init", "-q", "--bare", "-b", "main");
  const root = tmp("telar-cleanup-repo-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@telar.local");
  git(root, "config", "user.name", "Telar Test");
  fs.writeFileSync(path.join(root, "README.md"), "hello\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "initial");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "origin", "main");
  let now = Date.now();
  const home = tmp("telar-cleanup-home-");
  fs.writeFileSync(path.join(home, "claude-default-model.json"), JSON.stringify({ model: "claude-opus-5[1m]", at: 1 }));
  const store = new EngineStore(home, () => now);
  store.projectRegistry.register({ id: "project_one", name: "One", root });
  const session = store.lifecycle.createSession({ id: "session_one", projectId: "project_one", envMode: "worktree" });
  await worktreeReady(store, "session_one");
  if (session.workspace.mode !== "worktree") throw new Error("expected a worktree");
  const checkout = session.workspace.path;
  git(checkout, "config", "user.email", "test@telar.local");
  git(checkout, "config", "user.name", "Telar Test");
  return { store, root, checkout, branch: session.workspace.branch, advance: (ms: number) => (now += ms) };
}

test("with removal off, a sweep touches nothing and records an empty result", async () => {
  const { store, checkout, advance } = await setup();
  store.cleanup.setPolicy({ settledDays: null });
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  advance(60 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(true);
  expect(store.cleanup.last()).toMatchObject({ released: 0, logs: 0, freedBytes: 0 });
});

test("an archived session keeps its checkout until the window passes, then it is released and the branch survives", async () => {
  const { store, root, checkout, branch, advance } = await setup();
  git(checkout, "push", "-q", "origin", branch);
  store.cleanup.setPolicy({ settledDays: 7 });
  store.lifecycle.archiveSession("session_one");
  advance(3 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(path.join(checkout, "README.md"))).toBe(true);
  advance(5 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(false);
  expect(git(root, "branch", "--list", branch)).toContain(branch);
  expect(store.cleanup.last()).toMatchObject({ released: 1 });
  const session = store.records.get("session_one");
  expect(session.workspace.mode === "worktree" && session.workspace.released?.reason).toBe("archived");
});

test("a settled session's clean, pushed worktree is released after three days by default, and comes back on reopening", async () => {
  const { store, checkout, branch, advance } = await setup();
  git(checkout, "push", "-q", "origin", branch);
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  advance(2 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(true);
  advance(2 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(false);
  const session = store.records.get("session_one");
  expect(session.workspace.mode === "worktree" && session.workspace.released?.reason).toBe("settled");
  store.worktrees.restore("session_one");
  await until("the worktree is back", () => fs.existsSync(path.join(checkout, "README.md")));
});

test("the settled release never touches a dirty or an unpushed worktree", async () => {
  const dirty = await setup();
  git(dirty.checkout, "push", "-q", "origin", dirty.branch);
  fs.writeFileSync(path.join(dirty.checkout, "README.md"), "edited\n");
  dirty.store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  dirty.advance(10 * DAY);
  await dirty.store.worktrees.runCleanup();
  expect(fs.existsSync(path.join(dirty.checkout, "README.md"))).toBe(true);
  expect(dirty.store.cleanup.last()).toMatchObject({ released: 0, skipped: 1 });

  const unpushed = await setup();
  fs.writeFileSync(path.join(unpushed.checkout, "feature.txt"), "work\n");
  git(unpushed.checkout, "add", "-A");
  git(unpushed.checkout, "commit", "-qm", "feature");
  unpushed.store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  unpushed.advance(10 * DAY);
  await unpushed.store.worktrees.runCleanup();
  expect(fs.existsSync(path.join(unpushed.checkout, "feature.txt"))).toBe(true);
  expect(unpushed.store.cleanup.last()).toMatchObject({ released: 0, skipped: 1 });
});

test("the sweep never releases a session that is not idle", async () => {
  const { store, checkout, advance } = await setup();
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  store.intake.submitTurn("session_one", { runId: "run_busy", input: "working" });
  advance(10 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(true);
  expect(store.cleanup.last()).toMatchObject({ released: 0 });
});

function backgroundTask(store: EngineStore, state: "running" | "waiting", options: { ambient?: boolean } = {}) {
  store.intake.submitTurn("session_one", { runId: "run_bg", input: "Watch the build" });
  const claimed = store.claims.claimNextTurn("worker_one")!;
  const token = claimed.turn.claim!.token;
  store.turnLifecycle.markRunning("session_one", "run_bg", token);
  store.ingest.ingestObservations("session_one", "run_bg", token, [
    { kind: "task.started", task: { id: "task_bg", providerTaskId: "bg1", kind: "background", backgrounded: true, state, title: "Tail the log", ...options } },
  ]);
  store.turnLifecycle.completeTurn("session_one", "run_bg", token, { text: "Watching" });
}

test("live background work: the sweep leaves a monitoring session's checkout alone, and the reaper counts it live", async () => {
  const { store, checkout, advance } = await setup();
  backgroundTask(store, "running");
  expect(store.records.get("session_one").activity).toBe("monitoring");
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  advance(30 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(true);
  expect(store.cleanup.last()).toMatchObject({ released: 0 });
  store.lifecycle.archiveSession("session_one");
  expect(store.worktrees.reapable()).toEqual([expect.objectContaining({ sessionId: "session_one", archived: true, live: true })]);
});

test("paused or ambient background tasks are not live work: the sweep and the reaper may take the checkout", async () => {
  for (const [state, ambient] of [["waiting", false], ["running", true]] as const) {
    const { store, checkout, branch, advance } = await setup();
    git(checkout, "push", "-q", "origin", branch);
    backgroundTask(store, state, ambient ? { ambient } : {});
    expect(store.records.get("session_one").activity).toBe("idle");
    store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
    advance(10 * DAY);
    await store.worktrees.runCleanup();
    expect(fs.existsSync(checkout), `${state}${ambient ? " ambient" : ""}`).toBe(false);
    const archived = await setup();
    backgroundTask(archived.store, state, ambient ? { ambient } : {});
    archived.store.lifecycle.archiveSession("session_one");
    expect(archived.store.worktrees.reapable()).toEqual([expect.objectContaining({ sessionId: "session_one", live: false })]);
  }
});

test("an open terminal: the sweep skips the session's checkout, and the reaper counts it live (#883)", async () => {
  const { store, checkout, branch, advance } = await setup();
  git(checkout, "push", "-q", "origin", branch);
  store.sessionTerminals.attach({ openCount: (sessionId) => (sessionId === "session_one" ? 1 : 0), openSessions: () => ["session_one"], closeIdle: async () => 0, closeSession: async () => 1 });
  store.lifecycle.updateSession("session_one", { settledOverride: "settled" });
  advance(10 * DAY);
  await store.worktrees.runCleanup();
  expect(fs.existsSync(checkout)).toBe(true);
  expect(store.cleanup.last()).toMatchObject({ released: 0, skipped: 1 });
  store.lifecycle.archiveSession("session_one");
  expect(store.worktrees.reapable()).toEqual([expect.objectContaining({ sessionId: "session_one", live: true })]);
});

test("archiving keeps the checkout and drops its build output", async () => {
  const { store, root, checkout } = await setup();
  fs.appendFileSync(path.join(root, ".git/info/exclude"), ".next/\n");
  fs.mkdirSync(path.join(checkout, "web/.next/cache"), { recursive: true });
  store.lifecycle.archiveSession("session_one");
  await until("the build output is gone", () => !fs.existsSync(path.join(checkout, "web/.next")));
  expect(fs.existsSync(path.join(checkout, "README.md"))).toBe(true);
});

test("a policy outside the offered choices is refused", () => {
  const home = tmp("telar-cleanup-policy-");
  const store = new EngineStore(home, () => 1);
  expect(store.cleanup.setPolicy({ settledDays: 5 })).toBeUndefined();
});
