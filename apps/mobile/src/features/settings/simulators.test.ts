import { describe, expect, test } from "bun:test";
import type { SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import { pollDelay, simulatorBanner, simulatorSubtitle } from "./simulators";

const simulator = (extra: Partial<SimulatorSummary> = {}): SimulatorSummary => ({ id: "s", platform: "ios", name: "iPhone 17", version: "iOS 26.0", booted: false, physical: false, ...extra });
const hub = (extra: Partial<SimulatorsState>): SimulatorsState =>
  ({ status: "ready", hub: { requiredVersion: "1", installedVersions: [], runningVersion: null }, platforms: [], simulators: [simulator()], errors: [], ...extra }) as SimulatorsState;

describe("Simulators", () => {
  test("a ready hub with simulators shows no banner", () => {
    expect(simulatorBanner(hub({}))).toBeUndefined();
  });

  test("each hub state explains itself", () => {
    expect(simulatorBanner(hub({ status: "disabled" }))?.title).toBe("Simulators are off on this computer.");
    expect(simulatorBanner(hub({ status: "starting", detail: "Booting the hub" }))).toMatchObject({ title: "Getting simulators ready…", detail: "Booting the hub" });
    expect(simulatorBanner(hub({ status: "failed" }))?.tint).toBe("red");
    expect(simulatorBanner(hub({ simulators: [], platforms: [{ platform: "android", available: false, reason: "No SDK" }] }))).toMatchObject({ title: "No simulators found.", detail: "No SDK" });
    expect(simulatorBanner(hub({ errors: ["Hub crashed once"] }))).toMatchObject({ tint: "amber", title: "Hub crashed once" });
  });

  test("a settling hub is polled faster", () => {
    expect(pollDelay(hub({ status: "installing" }))).toBe(3000);
    expect(pollDelay(hub({}))).toBe(15000);
  });

  test("rows say what runs", () => {
    expect(simulatorSubtitle(simulator({ booted: true }))).toBe("iOS 26.0 · Running");
    expect(simulatorSubtitle(simulator())).toBe("iOS 26.0");
  });
});
