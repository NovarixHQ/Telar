import { expect, test } from "bun:test";
import { createClaudeDriver } from "./claude";
import { createCodexDriver } from "./codex";
import { createOpenCodeDriver } from "./opencode";
import { driverCapabilities } from "./capabilities";

test("the engine's lookup agrees with what each driver declares", () => {
  expect(driverCapabilities("claude")).toEqual(createClaudeDriver().capabilities);
  expect(driverCapabilities("codex")).toEqual(createCodexDriver().capabilities);
  expect(driverCapabilities("opencode")).toEqual(createOpenCodeDriver().capabilities);
});

test("a driver Telar does not ship gets nothing it has not proven", () => {
  expect(driverCapabilities("some-agent")).toEqual({
    liveSteering: false,
    compaction: "none",
    backgroundTaskStop: false,
    contextInjection: "inline",
    fork: false,
    usageLimits: false,
  });
});
