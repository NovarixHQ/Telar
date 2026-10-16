import { expect, test } from "bun:test";
import type { UsageLimitAccount } from "@telar/engine-client";
import { UsageLimitReader } from "./limit-reader";
import type { UsageLimitSources } from "./sources";

const SOURCE = { id: "hub", kind: "cliproxy" as const, url: "http://hub.local", managementKey: "k" };

function reader(accounts: UsageLimitAccount[], sources = [SOURCE]) {
  let reads = 0;
  const limits = new UsageLimitReader({ resolve: () => sources } as unknown as UsageLimitSources, async (source) => {
    reads += 1;
    return { id: source.id, kind: source.kind, label: "Hub", checkedAt: 1, accounts };
  });
  return { limits, reads: () => reads };
}

const account = (driver: string, windows: [string, number][]): UsageLimitAccount => ({
  id: driver,
  driver,
  windows: windows.map(([key, usedPercent]) => ({ key, label: key, usedPercent })),
});

test("a driver past 80% of an account-wide window is near its limit, with the fullest window named", async () => {
  const { limits } = reader([account("claude", [["five_hour", 82], ["seven_day", 91], ["model:Opus", 99]]), account("codex", [["primary", 40]])]);
  await limits.refresh();
  expect(limits.nearLimit("claude")).toEqual({ label: "seven_day", usedPercent: 91 });
  expect(limits.nearLimit("codex")).toBeUndefined();
  expect(limits.nearLimit("cursor")).toBeUndefined();
});

test("a window only one model counts against does not lower every builder", async () => {
  const { limits } = reader([account("claude", [["five_hour", 20], ["model:Opus", 95]])]);
  await limits.refresh();
  expect(limits.nearLimit("claude")).toBeUndefined();
});

test("with no hub configured nothing is read and nothing is near its limit", () => {
  const { limits, reads } = reader([], []);
  expect(limits.nearLimit("claude")).toBeUndefined();
  expect(reads()).toBe(0);
});
