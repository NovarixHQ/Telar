import { expect, test } from "bun:test";
import { fakeActionDeps as deps, iPhone, pixel } from "../../../test/fake-simulator-hub";
import { iosTextSize, readDetail } from "./detail";

const ios = { ...iPhone(), booted: true };
const emulator = { ...pixel(), id: "emulator-5554", booted: true };

test("iOS detail reads simctl and the helper's status, and a failed read leaves that setting unset", async () => {
  const { deps: d } = deps({
    "xcrun simctl ui A1B2-UDID appearance": { stdout: "dark\n" },
    "xcrun simctl ui A1B2-UDID content_size": { stdout: "accessibility-medium" },
    "xcrun simctl ui A1B2-UDID increase_contrast": { code: 1 },
    "xcrun simctl spawn A1B2-UDID /hub/ax status": { stdout: '{"reduce-motion":"on","voiceover":"off","liquid-glass":"tinted"}' },
  });
  expect(await readDetail(d, ios, 7)).toEqual({
    id: "A1B2-UDID",
    configuration: { appearance: "dark", textSize: "extra-large", reduceMotion: true, voiceOver: false, liquidGlass: "tinted" },
    foregroundApp: null,
    readAt: 7,
  });
  expect(iosTextSize("large")).toBe("default");
  expect(iosTextSize("extra-large")).toBe("large");
  expect(iosTextSize("medium")).toBe("small");
});

test("Android detail reads its settings and the focused package", async () => {
  const { deps: d } = deps({
    "adb -s emulator-5554 shell cmd uimode night": { stdout: "Night mode: yes" },
    "adb -s emulator-5554 shell settings get system font_scale": { stdout: "1.15" },
    "adb -s emulator-5554 shell settings get global animator_duration_scale": { stdout: "0.0" },
    "adb -s emulator-5554 shell settings get global wifi_on": { stdout: "1" },
    "adb -s emulator-5554 shell dumpsys window": { stdout: "  mCurrentFocus=Window{1a2b u0 com.example.app/com.example.Main}" },
  });
  expect(await readDetail(d, emulator, 1)).toEqual({
    id: "emulator-5554",
    configuration: { appearance: "dark", textSize: "large", reduceMotion: true, networkEnabled: true },
    foregroundApp: { id: "com.example.app" },
    readAt: 1,
  });
});
