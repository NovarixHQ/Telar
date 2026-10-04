import type { AsyncGitRunner, GitResult, GitRunner } from "./runner";

const prefetchKey = (cwd: string, args: string[]): string => JSON.stringify([cwd, args]);

/** Only a ref the store's own validation would let through, so a prefetch never puts an unvalidated argument on a command line. */
export const prefetchableRef = (ref: string | undefined): string | undefined =>
  ref === undefined ? "HEAD" : /^[A-Za-z0-9][A-Za-z0-9._/@{}-]{0,200}$/.test(ref) ? ref : undefined;

/** What cutting a worktree asks git before it can be planned. */
export const cutQuestions = (baseRef: string | undefined): string[][] => {
  const base = prefetchableRef(baseRef);
  return [["rev-parse", "--is-inside-work-tree"], ...(base ? [["rev-parse", base]] : [])];
};

/**
 * A sqlite command cannot span an await, yet its `rev-parse` refusals must reach the caller. `around` reads them
 * off the pool first and answers them for exactly the synchronous call that follows; anything else runs nothing.
 */
export class PrefetchedGit {
  private answers: Map<string, GitResult> | undefined;
  readonly run: GitRunner;

  constructor(private readonly pool: AsyncGitRunner) {
    this.run = (cwd, args) =>
      this.answers?.get(prefetchKey(cwd, args)) ?? { status: 1, stdout: "", stderr: `git ${args.join(" ")} in ${cwd} was not read ahead, so it did not run` };
  }

  /** Whether the synchronous call now running can cut a worktree in `cwd` from what was read ahead. */
  answersCut(cwd: string, baseRef: string | undefined): boolean {
    return cutQuestions(baseRef).every((args) => this.answers?.has(prefetchKey(cwd, args)) === true);
  }

  async around<T>(cwd: string, questions: string[][], work: () => T): Promise<T> {
    const unique = new Map(questions.map((args) => [prefetchKey(cwd, args), args]));
    this.answers = new Map<string, GitResult>(
      await Promise.all([...unique].map(async ([key, args]) => [key, await this.pool(cwd, args)] as const)),
    );
    try {
      return work();
    } finally {
      this.answers = undefined;
    }
  }
}
