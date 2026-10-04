import { expect, test } from "bun:test";
import { PrefetchedGit } from "./prefetch";
import type { AsyncGitRunner } from "./runner";

test("a question that was not read ahead runs nothing and says so", async () => {
  const asked: string[][] = [];
  const pool: AsyncGitRunner = async (_cwd, args) => {
    asked.push(args);
    return { status: 0, stdout: "true\n", stderr: "" };
  };
  const git = new PrefetchedGit(pool);
  expect(git.run("/repo", ["rev-parse", "HEAD"])).toMatchObject({ status: 1, stderr: expect.stringContaining("not read ahead") });
  expect(git.answersCut("/repo", undefined)).toBe(false);
  expect(asked).toEqual([]);

  const inside = await git.around("/repo", [["rev-parse", "--is-inside-work-tree"], ["rev-parse", "HEAD"]], () => ({
    answered: git.run("/repo", ["rev-parse", "--is-inside-work-tree"]).stdout,
    cut: git.answersCut("/repo", undefined),
    elsewhere: git.answersCut("/other", undefined),
  }));
  expect(inside).toEqual({ answered: "true\n", cut: true, elsewhere: false });
  expect(git.answersCut("/repo", undefined)).toBe(false);
});
