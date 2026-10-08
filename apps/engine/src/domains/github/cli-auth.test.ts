import { expect, test } from "bun:test";
import { EngineStore } from "../../state";
import { useTempStores } from "../../../test/temp-store";
import { readCliAuth } from "./cli-auth";
import { failed, ok } from "./test-helpers";
import type { GhResult } from "./gh";

const { root } = useTempStores();
const answering = (result: GhResult) => async () => result;

test("a signed-in gh names its account", async () => {
  const status = "github.com\n  ✓ Logged in to github.com account octo-cat (keyring)\n  - Token: gho_************\n";
  expect(await readCliAuth(answering(ok(status)), "/")).toEqual({ signedIn: true, account: "octo-cat" });
  expect(await readCliAuth(answering(ok("✓ Logged in to github.com as octo-cat (oauth_token)")), "/")).toEqual({ signedIn: true, account: "octo-cat" });
});

test("a missing or signed-out gh says which", async () => {
  expect(await readCliAuth(answering(failed("spawn gh ENOENT", 127)), "/")).toEqual({ signedIn: false, unavailable: "not_installed" });
  const signedOut = failed("You are not logged into any GitHub hosts. To log in, run: gh auth login");
  expect(await readCliAuth(answering(signedOut), "/")).toEqual({ signedIn: false, unavailable: "not_authenticated" });
});

test("any other failure carries its first line, never a token line", async () => {
  const result = failed("  - Token: gho_************\nerror connecting to api.github.com\n");
  expect(await readCliAuth(answering(result), "/")).toEqual({ signedIn: false, unavailable: "failed", message: "error connecting to api.github.com" });
});

test("the engine asks gh without any project registered", async () => {
  const asked: string[][] = [];
  const store = new EngineStore(root(), () => 1_000, {
    git: () => ({ status: 0, stdout: "", stderr: "" }),
    gh: async (_cwd, args) => {
      asked.push(args);
      return ok("Logged in to github.com account octo-cat");
    },
  });
  expect(store.projectRegistry.list()).toEqual([]);
  expect(await store.github.cliAuth()).toEqual({ signedIn: true, account: "octo-cat" });
  expect(asked).toEqual([["auth", "status", "--active"]]);
});
