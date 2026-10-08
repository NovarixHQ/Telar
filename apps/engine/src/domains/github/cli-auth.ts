import type { GitHubCliAuth } from "@telar/engine-client";
import type { GhRunner } from "./gh";

/** `gh auth status` prints a masked token, so only the account name and a failure's first line leave this function. */
export async function readCliAuth(gh: GhRunner, cwd: string): Promise<GitHubCliAuth> {
  const result = await gh(cwd, ["auth", "status", "--active"]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    const account = /Logged in to \S+ (?:account|as) ([A-Za-z0-9-]+)/.exec(output)?.[1];
    return { signedIn: true, ...(account ? { account } : {}) };
  }
  if (result.status === 127) return { signedIn: false, unavailable: "not_installed" };
  if (/not logged in|gh auth login/i.test(output)) return { signedIn: false, unavailable: "not_authenticated" };
  const message = output.split("\n").map((line) => line.trim()).find((line) => line && !/token/i.test(line));
  return { signedIn: false, unavailable: "failed", ...(message ? { message } : {}) };
}
