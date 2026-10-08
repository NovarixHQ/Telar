import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GitOverview, GitRefEntry, Session } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { BaseRefPicker, EnvironmentStrip, readWorkspaceGit } from "./workspace-environment";

const session = { id: "session_1", projectId: "p1", workspace: { mode: "worktree", branch: "telar/x" } } as unknown as Session;

const git = (extra: Partial<GitOverview> = {}): GitOverview =>
  ({ repository: true, branch: "main", dirtyFiles: 3, ahead: 2, behind: 1, worktrees: [], ...extra }) as GitOverview;

const render = (props: Parameters<typeof EnvironmentStrip>[0]) => renderToStaticMarkup(<EnvironmentStrip {...props} />);

describe("the composer's foot", () => {
  test("a live session draws nothing there: its branch and changes are in the Workspace card", () => {
    expect(render({ projectId: "p1", projectName: "aurora", session, git: git() })).toBe("");
  });

  test("a fresh canvas offers where this lands; a live session does not", () => {
    const fresh = render({ projectId: "p1", projectName: "aurora", envMode: "worktree", onEnvMode: () => {} });
    expect(fresh).toContain('aria-label="Where this lands"');
    expect(fresh).toContain("aurora");
    expect(render({ projectId: "p1", projectName: "aurora", session, envMode: "worktree", onEnvMode: () => {} })).toBe("");
  });
});

/**
 * THE BASE PICKER, ON A LISTING THAT IS NOT THE REPOSITORY — issue #650.
 *
 * The engine change alone does not fix this bug. `refsIncomplete` reaching the
 * client is worth nothing if the picker draws a timed-out listing exactly as it
 * draws a repository with no branches: the person still reads a short list as
 * complete and cuts their session from a base they did not mean. What is pinned
 * here is that the two are DIFFERENT SENTENCES, and that the timeout carries
 * something a person can do about it.
 */
describe("the base-ref picker when git did not answer", () => {
  const refs: GitRefEntry[] = [{ name: "origin/main", kind: "remote" }];
  const picker = (props: Partial<Parameters<typeof BaseRefPicker>[0]> = {}) =>
    renderToStaticMarkup(<BaseRefPicker refs={refs} pending={{}} onBase={() => {}} {...props} />);

  test("a whole listing says nothing — no notice on the ordinary path", () => {
    const markup = picker();
    expect(markup).not.toContain("did not answer");
    expect(markup).not.toContain("Ask git again");
  });

  test("a timed-out listing says git did not answer, and offers to ask again", () => {
    const markup = picker({ incomplete: "timeout", onRetry: () => {} });
    expect(markup).toContain("did not answer in time");
    expect(markup).toContain("missing branches");
    // Retry is the honest offer: the machine was busy, the answer may differ.
    expect(markup).toContain("Ask git again");
  });

  test("a listing that failed for another reason is a different sentence", () => {
    // Retrying a repository git cannot read is not the same promise as retrying
    // a machine under load, so the prose must not claim it is.
    const markup = picker({ incomplete: "failed", onRetry: () => {} });
    expect(markup).toContain("could not list");
    expect(markup).not.toContain("did not answer in time");
  });

  test("no retry button when the caller has no way to ask again", () => {
    // A button that does nothing is worse than no button.
    expect(picker({ incomplete: "timeout" })).not.toContain("Ask git again");
  });

  test("an empty list is a CLAIM about the repository, and only safe when whole", () => {
    // The defect in one assertion: these two states used to render the same.
    expect(picker({ refs: [] })).toContain("This repository has no branches yet");
    const stalled = picker({ refs: [], incomplete: "timeout" });
    expect(stalled).not.toContain("This repository has no branches yet");
    expect(stalled).toContain("did not answer in time");
  });

  test("the refs that did arrive stay pickable under the notice", () => {
    // A misleading list traded for a useless one would be no improvement: what
    // git did answer is still a perfectly good base.
    const markup = picker({ incomplete: "timeout", onRetry: () => {} });
    expect(markup).toContain("origin/main");
  });
});

describe("the uncommitted count", () => {
  const engine = (worktreeFiles: string[] | "gone") =>
    createEngineApi(async (url) => {
      const path = String(url);
      if (path === "/api/projects/p1/git") return Response.json({ git: git({ dirtyFiles: 7 }) });
      if (path === "/api/sessions/session_1/git/status") {
        if (worktreeFiles === "gone") return Response.json({ error: { code: "not_found", message: "gone" } }, { status: 404 });
        return Response.json({ dirtyFiles: worktreeFiles.length });
      }
      return Response.json({ error: { code: "not_found", message: path } }, { status: 404 });
    });

  test("a worktree session counts its own worktree, not the project's checkout", async () => {
    expect((await readWorkspaceGit(engine([]), "p1", "session_1")).dirtyFiles).toBe(0);
    expect((await readWorkspaceGit(engine(["a.ts", "b.ts"]), "p1", "session_1")).dirtyFiles).toBe(2);
  });

  test("a session on the checkout counts the checkout", async () => {
    expect((await readWorkspaceGit(engine([]), "p1")).dirtyFiles).toBe(7);
  });

  test("an unchanged worktree answers 304 and keeps its count", async () => {
    const asked: Array<string | undefined> = [];
    const conditional = createEngineApi(async (url, init) => {
      const path = String(url);
      if (path === "/api/projects/p1/git") return Response.json({ git: git({ dirtyFiles: 7 }) });
      const tag = (init?.headers as Record<string, string> | undefined)?.["if-none-match"];
      asked.push(tag);
      if (tag === '"t1"') return new Response(null, { status: 304, headers: { etag: '"t1"' } });
      return Response.json({ dirtyFiles: 4 }, { headers: { etag: '"t1"' } });
    });
    const own = {};
    expect((await readWorkspaceGit(conditional, "p1", "session_1", own)).dirtyFiles).toBe(4);
    expect((await readWorkspaceGit(conditional, "p1", "session_1", own)).dirtyFiles).toBe(4);
    expect(asked).toEqual([undefined, '"t1"']);
  });

  test("an unreadable worktree draws no count rather than the checkout's", async () => {
    const read = await readWorkspaceGit(engine("gone"), "p1", "session_1");
    expect(read.dirtyFiles).toBeUndefined();
    expect(read.branch).toBe("main");
  });
});

describe("a folder that can't be reached", () => {
  test("the composer says so, names why, and offers a retry", () => {
    const markup = render({ projectId: "p1", projectName: "aurora", session, git: git({ availability: "denied" }), onRetry: () => {} });
    expect(markup).toContain("Folder unreachable:");
    expect(markup).toContain("macOS or a security tool is denying access to the folder for aurora");
    expect(markup).toContain(">Retry<");
  });

  test("a reachable folder draws no banner", () => {
    expect(render({ projectId: "p1", session, git: git({ availability: "available" }), onRetry: () => {} })).not.toContain("Folder unreachable");
  });
});
