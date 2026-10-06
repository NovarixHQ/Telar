import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine } from "../../daemon";
import { EngineStore } from "../../state";
import { stubModels } from "../../../test/stub-models";
import { worktreeReady } from "../../../test/worktree-ready";
import { engineHome, removeTmp, repo, tmp } from "../../../test/worktree-fixtures";

afterEach(removeTmp);

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function registered(root: string): EngineStore {
  const store = new EngineStore(engineHome("telar-relocate-state-"), () => 1_000);
  store.projectRegistry.register({ id: "project_one", name: "One", root });
  return store;
}

function moveAway(root: string): string {
  const next = path.join(tmp("telar-relocate-to-"), "moved");
  fs.renameSync(root, next);
  return fs.realpathSync.native(next);
}

test("a moved folder keeps the project's id and settings, and it is available again", async () => {
  const root = tmp("telar-relocate-plain-");
  const store = registered(root);
  store.projectRegistry.update("project_one", { name: "Renamed", envMode: "local" });
  const moved = moveAway(root);
  expect(await store.projectProbes.probe(store.projectRegistry.get("project_one"))).toBe("missing");

  const project = await store.remounts.relocate("project_one", moved);

  expect(project).toMatchObject({ id: "project_one", name: "Renamed", envMode: "local", root: moved, availability: "available" });
  expect(store.projectRegistry.list().map((entry) => [entry.id, entry.root, entry.availability])).toEqual([["project_one", moved, "available"]]);
});

test("local sessions follow the new root", async () => {
  const root = tmp("telar-relocate-plain-");
  const store = registered(root);
  store.lifecycle.createSession({ id: "session_one", projectId: "project_one", envMode: "local" });
  const moved = moveAway(root);

  await store.remounts.relocate("project_one", moved);

  expect(store.records.get("session_one").workspace).toMatchObject({ mode: "local", path: moved });
});

test("a folder that is not there is refused and nothing changes", async () => {
  const root = tmp("telar-relocate-plain-");
  const store = registered(root);

  await expect(store.remounts.relocate("project_one", path.join(root, "nope"))).rejects.toThrow("project root must be an existing directory");
  expect(store.projectRegistry.get("project_one").root).toBe(fs.realpathSync.native(root));
});

test("a folder another project already uses is refused", async () => {
  const root = tmp("telar-relocate-plain-");
  const other = tmp("telar-relocate-other-");
  const store = registered(root);
  store.projectRegistry.register({ id: "project_two", name: "Two", root: other });

  await expect(store.remounts.relocate("project_one", other)).rejects.toThrow("Two already uses that folder");
  expect(store.projectRegistry.get("project_one").root).toBe(fs.realpathSync.native(root));
});

test("a project that was a git repository refuses a folder that is not one", async () => {
  const root = repo();
  const store = registered(root);
  await store.requestPath.createSession({ id: "session_tree", projectId: "project_one", envMode: "worktree" });
  await worktreeReady(store, "session_tree");
  fs.rmSync(root, { recursive: true, force: true });

  await expect(store.remounts.relocate("project_one", tmp("telar-relocate-plain-"))).rejects.toThrow("One was a git repository");
});

test("worktree sessions are re-linked to the moved repository and keep working", async () => {
  const root = repo();
  const store = registered(root);
  await store.requestPath.createSession({ id: "session_tree", projectId: "project_one", envMode: "worktree" });
  await worktreeReady(store, "session_tree");
  const before = store.records.get("session_tree").workspace;
  if (before.mode !== "worktree") throw new Error("expected a worktree workspace");
  const moved = moveAway(root);
  expect(() => git(before.path, "status")).toThrow();

  await store.remounts.relocate("project_one", moved);

  expect(store.records.get("session_tree").workspace).toEqual(before);
  expect(git(before.path, "rev-parse", "--path-format=absolute", "--git-common-dir")).toBe(path.join(moved, ".git"));
  expect(git(moved, "worktree", "list", "--porcelain")).toContain(`worktree ${fs.realpathSync.native(before.path)}`);
});

test("a clone that never had the session's worktree is refused rather than adopted", async () => {
  const root = repo();
  const store = registered(root);
  await store.requestPath.createSession({ id: "session_tree", projectId: "project_one", envMode: "worktree" });
  await worktreeReady(store, "session_tree");
  const clone = path.join(tmp("telar-relocate-clone-"), "clone");
  git(path.dirname(clone), "clone", "-q", root, clone);
  fs.rmSync(root, { recursive: true, force: true });

  await expect(store.remounts.relocate("project_one", clone)).rejects.toThrow("cut from a different copy of this repository");
  expect(store.projectRegistry.get("project_one").root).not.toBe(fs.realpathSync.native(clone));
});

test("over the wire the project comes back available under the same id", async () => {
  const daemon = await startEngine({ models: stubModels, engineRoot: engineHome("telar-relocate-daemon-") });
  try {
    const client = new EngineClient(daemon.discovery);
    const root = tmp("telar-relocate-plain-");
    await client.registerProject({ id: "project_one", name: "One", root });
    const moved = moveAway(root);

    expect((await client.relocateProject("project_one", moved)).project).toMatchObject({ id: "project_one", root: moved, availability: "available" });
    expect((await client.listProjects()).projects).toMatchObject([{ id: "project_one", root: moved, availability: "available" }]);
  } finally {
    await daemon.close();
  }
});
