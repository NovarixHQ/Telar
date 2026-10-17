import { expect, test } from "bun:test";
import { providerCliInvocation } from "./cli-guard";

test("flags a provider CLI run as a command, behind wrappers, pipes and env", () => {
  expect(providerCliInvocation('agent --mode ask "map the repo"')).toBe("agent");
  expect(providerCliInvocation("timeout 600 codex exec 'fix it'")).toBe("codex");
  expect(providerCliInvocation("cd /tmp && FOO=1 cursor-agent -p hi | tee out.txt")).toBe("cursor-agent");
  expect(providerCliInvocation("/usr/local/bin/opencode run x")).toBe("opencode");
});

test("leaves version checks, other tools and mere mentions alone", () => {
  expect(providerCliInvocation("claude --version")).toBeUndefined();
  expect(providerCliInvocation("codex login status")).toBeUndefined();
  expect(providerCliInvocation("gh pr list")).toBeUndefined();
  expect(providerCliInvocation("grep -rn codex src/")).toBeUndefined();
  expect(providerCliInvocation("echo agent")).toBeUndefined();
});
