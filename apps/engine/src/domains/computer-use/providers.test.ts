import { describe, expect, test } from "bun:test";
import { COMPUTER_USE_DRIVERS, driverTakesComputerUse, type ProviderDriverKind } from "@telar/engine-client";
import { codexComputerUse } from "../../drivers/codex";
import { claimComputerUse, COMPUTER_USE_SERVER_ID, createComputerUseGate, resolveComputerUse, type ComputerUseProbe } from "./gate";
import { mcpConfiguration } from "../../drivers/opencode";
import type { DriverRun } from "../../drivers";

const DRIVERS: readonly ProviderDriverKind[] = ["claude", "codex", "opencode"];

const HOME = "/Users/tester";
const CUA = `${HOME}/.local/bin/cua-driver`;
const probe: ComputerUseProbe = { env: {}, home: HOME, platform: "darwin", exists: (candidate) => candidate === CUA, now: () => 0 };
const cua = resolveComputerUse(probe)!;

describe("the computer-use tool set, per provider", () => {
  test("every provider is handed it, Codex included", () => {
    for (const driver of DRIVERS) expect(claimComputerUse(driver, cua)).toEqual({ command: CUA, args: ["mcp"] });
  });

  test("the claim fold and the published list are the same fact", () => {
    for (const driver of DRIVERS) expect(claimComputerUse(driver, cua) !== undefined).toBe(driverTakesComputerUse(driver));
    expect([...COMPUTER_USE_DRIVERS].sort()).toEqual(["claude", "codex", "opencode"]);
  });
});

describe("Codex carries it as the `mac` server", () => {
  test("the server reaches Codex's config under Telar's id", () => {
    expect(codexComputerUse(claimComputerUse("codex", cua))).toEqual({ [COMPUTER_USE_SERVER_ID]: { command: CUA, args: ["mcp"] } });
  });

  test("a gate that has not measured `granted` hands Codex nothing", async () => {
    for (const permission of ["denied", "unauthenticated", "unknown"] as const) {
      const gate = createComputerUseGate(probe, { status: async () => ({ installed: true, backend: "cua", hostRunning: true, permission }), hostRunning: async () => true });
      await gate.measure();
      expect(codexComputerUse(claimComputerUse("codex", gate.forClaim()))).toBeUndefined();
    }
  });
});

describe("OpenCode carries it as an ordinary local server", () => {
  const run: DriverRun = {
    sessionId: "session_one",
    cwd: "/tmp/project",
    prompt: "hello",
    signal: new AbortController().signal,
    onObservations: async () => {},
    computerUse: claimComputerUse("opencode", cua)!,
  };

  test("the command and its args survive into OpenCode's own config", () => {
    expect(mcpConfiguration(run)[COMPUTER_USE_SERVER_ID]).toEqual({ type: "local", command: [CUA, "mcp"], environment: undefined });
  });
});
