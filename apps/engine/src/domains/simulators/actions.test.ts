import { expect, test } from "bun:test";
import type { SimulatorAction } from "@telar/engine-client";
import { fakeActionDeps as deps, iPhone, pixel } from "../../../test/fake-simulator-hub";
import { runAction, supportsAction } from "./actions";

const ios = { ...iPhone(), booted: true };
const emulator = { ...pixel(), id: "emulator-5554", booted: true };

test("iOS settings run simctl, and the accessibility switches go through the hub's helper", async () => {
  const { deps: d, commands } = deps();
  await runAction(d, ios, { type: "setAppearance", value: "dark" });
  await runAction(d, ios, { type: "setTextSize", value: "large" });
  await runAction(d, ios, { type: "setToggle", setting: "increaseContrast", value: true });
  await runAction(d, ios, { type: "setToggle", setting: "reduceMotion", value: true });
  await runAction(d, ios, { type: "setLocation", latitude: 52.37, longitude: 4.89 });
  await runAction(d, ios, { type: "setPermission", appId: "com.example", permission: "camera", decision: "grant" });
  await runAction(d, ios, { type: "setPermission", appId: "com.example", permission: "notifications", decision: "revoke" });
  expect(commands()).toEqual([
    "xcrun simctl ui A1B2-UDID appearance dark",
    "xcrun simctl ui A1B2-UDID content_size extra-extra-large",
    "xcrun simctl ui A1B2-UDID increase_contrast enabled",
    "xcrun simctl spawn A1B2-UDID /hub/ax set reduce-motion on",
    "xcrun simctl location A1B2-UDID set 52.37,4.89",
    "xcrun simctl privacy A1B2-UDID grant camera com.example",
    "node /hub/serve-sim.js permissions revoke notifications com.example -d A1B2-UDID",
  ]);
});

test("a push with a bare string is wrapped as an alert and piped on stdin", async () => {
  const { deps: d, runs } = deps();
  await runAction(d, ios, { type: "sendPush", appId: "com.example", payload: "Hello" });
  expect(runs[0]).toEqual({ file: "xcrun", args: ["simctl", "push", "A1B2-UDID", "com.example", "-"], input: '{"aps":{"alert":"Hello"}}' });
});

test("Android turns an emulator with the accelerometer and locks a physical phone", async () => {
  const emu = deps();
  await runAction(emu.deps, emulator, { type: "setOrientation", value: "landscape_left" });
  expect(emu.commands()).toEqual([
    "adb -s emulator-5554 shell settings put system accelerometer_rotation 1",
    "adb -s emulator-5554 shell cmd window user-rotation free",
    "adb -s emulator-5554 emu sensor set acceleration 9.81:0:0",
  ]);
  const phone = deps();
  await runAction(phone.deps, { ...emulator, id: "R58M", physical: true }, { type: "setOrientation", value: "landscape_left" });
  expect(phone.commands()).toEqual(["adb -s R58M shell cmd window user-rotation lock 1"]);
});

test("an action the platform lacks is refused before anything runs", async () => {
  const unsupported: Array<[typeof ios, SimulatorAction]> = [
    [emulator, { type: "sendPush", appId: "com.example", payload: "Hi" }],
    [ios, { type: "setOrientation", value: "portrait" }],
    [ios, { type: "setToggle", setting: "networkEnabled", value: false }],
    [emulator, { type: "setPermission", appId: "com.example", permission: "faceid", decision: "grant" }],
  ];
  for (const [device, action] of unsupported) {
    const { deps: d, runs } = deps();
    expect(supportsAction(device.platform, action)).toBe(false);
    await expect(runAction(d, device, action)).rejects.toThrow("is not supported on");
    expect(runs).toEqual([]);
  }
});

test("a missing helper and a failing command say so, without the command's output", async () => {
  const { deps: noHelper } = deps({}, {} as never);
  await expect(runAction(noHelper, ios, { type: "setToggle", setting: "voiceOver", value: true })).rejects.toThrow("missing");
  const { deps: failing } = deps({ "xcrun simctl openurl A1B2-UDID https://example.com": { code: 3, stderr: "/Users/someone/private" } });
  await expect(runAction(failing, ios, { type: "openUrl", url: "https://example.com" })).rejects.toThrow(/^openUrl failed \(exit code 3\)\.$/);
});
