import { expect, test } from "bun:test";
import type { ProviderInstance, ProviderProbe } from "@telar/engine-client";
import { offeredDrivers } from "./offered";

const instance = (driver: string, enabled: boolean): ProviderInstance => ({ id: driver, driver, enabled, env: [], createdAt: 0, updatedAt: 0 });
const probe = (driver: string, installed: boolean): ProviderProbe => ({ instanceId: driver, driver, status: installed ? "ready" : "error", installed, signIn: "unknown", checkedAt: 0 });
const instances = [instance("claude", true), instance("codex", true), instance("opencode", false), instance("cursor", true)];

test("a disabled provider is not offered, and a provider whose CLI is missing is not either", () => {
  expect(offeredDrivers(instances, [probe("cursor", false)])).toEqual(["claude", "codex"]);
});

test("the session's own provider stays listed when it is off", () => {
  expect(offeredDrivers(instances, [], "opencode")).toEqual(["claude", "codex", "opencode", "cursor"]);
});

test("before anything loads only the session's own provider is offered", () => {
  expect(offeredDrivers(undefined, undefined, "codex")).toEqual(["codex"]);
});
