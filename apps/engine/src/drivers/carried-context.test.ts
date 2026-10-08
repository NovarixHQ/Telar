import { expect, test } from "bun:test";
import { CODEX_CAPABILITIES, CLAUDE_CAPABILITIES } from "./capabilities";
import { withCarriedContext } from "./carried-context";
import type { DriverRun } from "./contract";

test("an inline driver reads the carried context before the message; a native one is handed it", () => {
  const run: Pick<DriverRun, "prompt" | "carriedContext"> = { prompt: "next step" };
  expect(withCarriedContext(run, "earlier turns", CLAUDE_CAPABILITIES)).toEqual({ prompt: "earlier turns\n\n---\n\nnext step" });
  expect(withCarriedContext(run, "earlier turns", CODEX_CAPABILITIES)).toEqual({ prompt: "next step", carriedContext: "earlier turns" });
  expect(withCarriedContext(run, undefined, CLAUDE_CAPABILITIES)).toBe(run);
});
