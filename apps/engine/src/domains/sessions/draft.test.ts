import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";
import { worktreeReady } from "../../../test/worktree-ready";
import type { AsyncGitRunner, GitResult, GitRunner } from "../../platform/git/runner";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-browser-draft-"));
  roots.push(root);
  const calls: string[][] = [];
  let rejectWorktree = false;
  const git: GitRunner = (_cwd, args) => {
    calls.push(args);
    if (args[0] === "worktree" && args[1] === "add") {
      if (rejectWorktree) return { status: 1, stdout: "", stderr: "fixture refused worktree" };
      fs.mkdirSync(args[4]!, { recursive: true });
    }
    return { status: 0, stdout: args.includes("--is-inside-work-tree") ? "true\n" : "abc123\n", stderr: "" };
  };
  const store = new EngineStore(path.join(root, "engine"), () => 100, { git });
  store.projectRegistry.register({ id: "project_draft", name: "Draft", root });
  return { store, root, git, calls, reject: () => { rejectWorktree = true; } };
}

/**
 * The cut runs in the background now (#496); the row is how you know it landed.
 *
 * THE SHARED ONE (#706). This was a third copy of the same loop with the same
 * two-second ceiling — a budget picked as though the cut ran alone, against a
 * git pool the whole suite shares.
 */
const settled = worktreeReady;

test("a browser draft survives reload without a turn or worktree and materializes once on first send", async () => {
  const { store, root, git, calls } = fixture();
  const draft = store.lifecycle.createSession({ id: "session_draft", projectId: "project_draft", draft: true, title: "Browser draft", envMode: "worktree", baseRef: "main", branchName: "browser-work", driver: "codex" });
  store.lifecycle.updateSession(draft.id, { runtimeMode: "approval-required", model: { instanceId: draft.providerInstanceId, model: "fixture-model", effort: "medium" } });
  expect(draft.workspace.mode).toBe("local");
  expect(calls.some((args) => args[0] === "worktree")).toBe(false);
  expect(store.queries.turns(draft.id)).toHaveLength(0);
  expect(store.lifecycle.createSession({ id: draft.id, projectId: "project_draft", draft: true }).id).toBe(draft.id);
  const reopened = new EngineStore(path.join(root, "engine"), () => 200, { git });
  expect(reopened.records.get(draft.id)).toMatchObject({ draft: { baseRef: "main", branchName: "browser-work" }, driver: "codex", runtimeMode: "approval-required", model: { model: "fixture-model", effort: "medium" } });
  const input = { runId: "run_first", input: "Build the browser draft" };
  reopened.intake.submitTurn(draft.id, input);
  expect(reopened.records.get(draft.id)).toMatchObject({ title: input.input, envMode: "worktree", workspace: { mode: "worktree", branch: "browser-work" } });
  expect(reopened.records.get(draft.id).draft).toBeUndefined();
  expect(reopened.intake.submitTurn(draft.id, input).replayed).toBe(true);
  // THE PROMOTION IS SYNCHRONOUS AND THE CUT IS NOT (#496): the row above is
  // already a worktree on its final branch, and the `worktree add` behind it
  // has to be waited for — exactly once, however many sends arrive.
  await settled(reopened, draft.id);
  expect(reopened.records.get(draft.id).preparation).toBeUndefined();
  expect(calls.filter((args) => args[0] === "worktree" && args[1] === "add")).toHaveLength(1);
  expect(reopened.queries.turns(draft.id)).toHaveLength(1);
});

test("a failed first-send workspace allocation lands on the row, and still runs nothing", async () => {
  /**
   * THIS CHANGED WITH #496 and the change is worth stating.
   *
   * The send used to throw `fixture refused worktree` back at the caller and
   * leave the draft a draft, because the cut ran inside it. The cut is now
   * behind the send, so by the time git refuses there is nobody to throw at:
   * the draft has been promoted, the message is queued, and the failure is on
   * the row with git's own words on it.
   *
   * WHAT DID NOT CHANGE IS THE PROPERTY THE TEST WAS PROTECTING: nothing runs
   * in a checkout that does not exist. `claimTurn` is what holds it now rather
   * than the throw, and the message keeps its place instead of being lost.
   */
  const { store, reject } = fixture();
  const draft = store.lifecycle.createSession({ projectId: "project_draft", draft: true, envMode: "worktree" });
  reject();
  expect(() => store.intake.submitTurn(draft.id, { runId: "run_first", input: "Try work" })).not.toThrow();

  await settled(store, draft.id);
  const session = store.records.get(draft.id);
  expect(session.preparation?.state).toBe("failed");
  expect(session.preparation?.error).toContain("fixture refused");
  expect(session.draft).toBeUndefined();
  expect(store.queries.turns(draft.id)).toHaveLength(1);
  expect(store.claims.claimTurn(draft.id, "worker_one")).toBeUndefined();
});

test("discarding a browser draft never removes the project checkout", () => {
  const { store, calls, root } = fixture();
  const draft = store.lifecycle.createSession({ projectId: "project_draft", draft: true, envMode: "worktree" });
  store.lifecycle.archiveSession(draft.id);
  expect(calls.some((args) => args[0] === "worktree")).toBe(false);
  expect(fs.existsSync(root)).toBe(true);
});

test("a local browser draft retains its id and title on first send without git worktree actions", () => {
  const { store, calls } = fixture();
  const draft = store.lifecycle.createSession({ projectId: "project_draft", draft: true, title: "My research", envMode: "local" });
  store.intake.submitTurn(draft.id, { runId: "run_first", input: "Continue research" });
  expect(store.records.get(draft.id)).toMatchObject({ id: draft.id, title: "My research", workspace: { mode: "local" } });
  expect(store.records.get(draft.id).draft).toBeUndefined();
  expect(calls.some((args) => args[0] === "worktree")).toBe(false);
});

test("an archived or compact-only draft cannot allocate a workspace or start an agent", () => {
  const { store, calls } = fixture();
  const draft = store.lifecycle.createSession({ projectId: "project_draft", draft: true, envMode: "worktree" });
  expect(() => store.intake.submitTurn(draft.id, { runId: "run_compact", input: "Compact", kind: "compact" })).toThrow(/no conversation/);
  store.lifecycle.archiveSession(draft.id);
  expect(() => store.intake.submitTurn(draft.id, { runId: "run_archived", input: "Start" })).toThrow(/archived/);
  expect(calls.some((args) => args[0] === "worktree")).toBe(false);
  expect(store.queries.turns(draft.id)).toHaveLength(0);
});

test("a first send nobody read git ahead for plans the cut without git and asks the base through the pool", async () => {
  const { store, calls } = fixture();
  const draft = store.lifecycle.createSession({ projectId: "project_draft", draft: true, envMode: "worktree", baseRef: "main" });
  store.intake.submitTurn(draft.id, { runId: "run_first", input: "From a schedule" });
  expect(store.records.get(draft.id)).toMatchObject({ workspace: { mode: "worktree" }, preparation: { state: "preparing" } });
  expect(store.records.get(draft.id).workspace).not.toHaveProperty("baseRef");

  await settled(store, draft.id);
  expect(store.records.get(draft.id)).toMatchObject({ workspace: { mode: "worktree", baseRef: "abc123" } });
  expect(store.records.get(draft.id).preparation).toBeUndefined();
  expect(calls.filter((args) => args.join(" ") !== "rev-parse HEAD").slice(0, 3)).toEqual([
    ["rev-parse", "--is-inside-work-tree"],
    ["rev-parse", "main"],
    expect.arrayContaining(["worktree", "add", "abc123"]),
  ]);
});

test("a deferred cut in a folder that is not a repository fails on the row, in the words the send used to throw", async () => {
  const { store } = fixture();
  const notGit: GitRunner = () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
  const plain = new EngineStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "telar-draft-plain-")), "engine"), () => 100, { git: notGit });
  plain.projectRegistry.register(store.projectRegistry.get("project_draft"));
  const draft = plain.lifecycle.createSession({ projectId: "project_draft", draft: true, envMode: "worktree" });
  plain.intake.submitTurn(draft.id, { runId: "run_first", input: "Try work" });
  await settled(plain, draft.id);
  expect(plain.records.get(draft.id).preparation).toMatchObject({ state: "failed", error: expect.stringContaining("worktree sessions need a git repository") });
});

test("a slow git behind a deferred cut holds up no other command", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-draft-slow-"));
  roots.push(root);
  const waiting: Array<{ args: string[]; release: () => void }> = [];
  const asyncGit: AsyncGitRunner = (_cwd, args) => new Promise<GitResult>((resolve) => {
    if (args[0] === "worktree" && args[1] === "add") fs.mkdirSync(args[4]!, { recursive: true });
    waiting.push({ args, release: () => resolve({ status: 0, stdout: args.includes("--is-inside-work-tree") ? "true\n" : "abc123\n", stderr: "" }) });
  });
  const store = new EngineStore(path.join(root, "engine"), () => 100, { asyncGit });
  store.projectRegistry.register({ id: "project_draft", name: "Draft", root });
  const draft = store.lifecycle.createSession({ projectId: "project_draft", draft: true, envMode: "worktree" });
  const other = store.lifecycle.createSession({ projectId: "project_draft" });

  store.intake.submitTurn(draft.id, { runId: "run_first", input: "From a wake" });
  await Promise.resolve();
  expect(waiting.map((call) => call.args)).toContainEqual(["rev-parse", "--is-inside-work-tree"]);
  expect(store.intake.submitTurn(other.id, { runId: "run_other", input: "meanwhile" }).turn.state).toBe("queued");
  expect(store.claims.claimTurn(other.id, "worker_one")?.runId).toBe("run_other");
  expect(store.records.get(draft.id).preparation?.state).toBe("preparing");

  while (store.records.get(draft.id).preparation?.state === "preparing") {
    for (const call of waiting.splice(0)) call.release();
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(store.records.get(draft.id)).toMatchObject({ workspace: { mode: "worktree", baseRef: "abc123" } });
});
