import type { SimulatorAction, SimulatorPermission, SimulatorSummary, SimulatorToggle } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import type { ProcessResult, ProcessRunner } from "../../platform/process/runner";

export type ActionDeps = { run: ProcessRunner["run"]; helpers: () => { axSettings?: string; serveSimCli?: string } };
type Platform = SimulatorSummary["platform"];

const IOS_TOGGLES = new Set<SimulatorToggle>(["reduceMotion", "increaseContrast", "reduceTransparency", "showBorders", "voiceOver"]);
const ANDROID_TOGGLES = new Set<SimulatorToggle>(["reduceMotion", "networkEnabled"]);
const IOS_ACTIONS = new Set<SimulatorAction["type"]>(["setAppearance", "setTextSize", "setToggle", "setLiquidGlass", "setColorFilter", "setLocation", "clearLocation", "setPermission", "openUrl", "launchApp", "terminateApp", "sendPush"]);
const ANDROID_ACTIONS = new Set<SimulatorAction["type"]>(["setAppearance", "setTextSize", "setToggle", "setOrientation", "setLocation", "clearLocation", "setPermission", "openUrl", "launchApp", "terminateApp"]);

export const IOS_TEXT_SIZES = { small: "small", default: "large", large: "extra-extra-large", "extra-large": "accessibility-large" } as const;
const ANDROID_FONT_SCALES = { small: "0.85", default: "1.0", large: "1.15", "extra-large": "1.3" } as const;
const AX_SETTINGS: Partial<Record<SimulatorToggle, string>> = { reduceMotion: "reduce-motion", reduceTransparency: "reduce-transparency", showBorders: "show-borders", voiceOver: "voiceover" };
const ANDROID_PERMISSIONS: Partial<Record<SimulatorPermission, string[]>> = {
  camera: ["CAMERA"],
  microphone: ["RECORD_AUDIO"],
  photos: ["READ_MEDIA_IMAGES", "READ_EXTERNAL_STORAGE"],
  contacts: ["READ_CONTACTS", "WRITE_CONTACTS"],
  calendar: ["READ_CALENDAR", "WRITE_CALENDAR"],
  location: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
  notifications: ["POST_NOTIFICATIONS"],
  motion: ["ACTIVITY_RECOGNITION"],
};
const GRAVITY = { portrait: "0:9.81:0", landscape_left: "9.81:0:0", portrait_upside_down: "0:-9.81:0", landscape_right: "-9.81:0:0" } as const;
const ROTATION = { portrait: "0", landscape_left: "1", portrait_upside_down: "2", landscape_right: "3" } as const;

export function supportsAction(platform: Platform, action: SimulatorAction): boolean {
  if (!(platform === "ios" ? IOS_ACTIONS : ANDROID_ACTIONS).has(action.type)) return false;
  if (action.type === "setToggle") return (platform === "ios" ? IOS_TOGGLES : ANDROID_TOGGLES).has(action.setting);
  if (action.type === "setPermission" && platform === "android") return ANDROID_PERMISSIONS[action.permission] !== undefined;
  return true;
}

const unsupported = (action: SimulatorAction, platform: Platform) => new HttpError(400, "invalid_request", `${action.type} is not supported on ${platform === "ios" ? "iOS" : "Android"}.`);
const helperMissing = () => new HttpError(409, "conflict", "This needs a part of the simulator hub that is missing. Turn simulators off and on again.");

async function ok(operation: string, result: Promise<ProcessResult>): Promise<void> {
  const { code } = await result;
  if (code !== 0) throw new HttpError(502, "provider_unavailable", `${operation} failed (exit code ${code ?? "none"}).`);
}

export async function runAction(deps: ActionDeps, device: SimulatorSummary, action: SimulatorAction): Promise<void> {
  if (!supportsAction(device.platform, action)) throw unsupported(action, device.platform);
  return device.platform === "ios" ? runIos(deps, device.id, action) : runAndroid(deps, device, action);
}

async function runIos(deps: ActionDeps, udid: string, action: SimulatorAction): Promise<void> {
  const simctl = (verb: string, ...rest: string[]) => ok(action.type, deps.run("xcrun", ["simctl", verb, udid, ...rest], { timeoutMs: 30_000 }));
  const ax = (...args: string[]) => {
    const helper = deps.helpers().axSettings;
    if (!helper) throw helperMissing();
    return ok(action.type, deps.run("xcrun", ["simctl", "spawn", udid, helper, ...args], { timeoutMs: 30_000 }));
  };
  switch (action.type) {
    case "setAppearance":
      return simctl("ui", "appearance", action.value);
    case "setTextSize":
      return simctl("ui", "content_size", IOS_TEXT_SIZES[action.value]);
    case "setToggle":
      if (action.setting === "increaseContrast") return simctl("ui", "increase_contrast", action.value ? "enabled" : "disabled");
      return ax("set", AX_SETTINGS[action.setting]!, action.value ? "on" : "off");
    case "setLiquidGlass":
      return ax("set", "liquid-glass", action.value);
    case "setColorFilter":
      return ax("set", "color-filter", action.value);
    case "setLocation":
      return simctl("location", "set", `${action.latitude},${action.longitude}`);
    case "clearLocation":
      return simctl("location", "clear");
    case "setPermission": {
      if (action.permission !== "notifications") return simctl("privacy", action.decision, action.permission, action.appId);
      const cli = deps.helpers().serveSimCli;
      if (!cli) throw helperMissing();
      return ok(action.type, deps.run("node", [cli, "permissions", action.decision, "notifications", action.appId, "-d", udid], { timeoutMs: 30_000 }));
    }
    case "openUrl":
      return simctl("openurl", action.url);
    case "launchApp":
      return simctl("launch", action.appId);
    case "terminateApp":
      return simctl("terminate", action.appId);
    case "sendPush": {
      const payload = typeof action.payload === "string" ? { aps: { alert: action.payload } } : action.payload;
      return ok(action.type, deps.run("xcrun", ["simctl", "push", udid, action.appId, "-"], { timeoutMs: 30_000, input: JSON.stringify(payload) }));
    }
    default:
      throw unsupported(action, "ios");
  }
}

async function runAndroid(deps: ActionDeps, device: SimulatorSummary, action: SimulatorAction): Promise<void> {
  const adb = (...args: string[]) => ok(action.type, deps.run("adb", ["-s", device.id, ...args], { timeoutMs: 30_000 }));
  const shell = (...args: string[]) => adb("shell", ...args);
  switch (action.type) {
    case "setAppearance":
      return shell("cmd", "uimode", "night", action.value === "dark" ? "yes" : "no");
    case "setTextSize":
      return shell("settings", "put", "system", "font_scale", ANDROID_FONT_SCALES[action.value]);
    case "setToggle":
      if (action.setting === "networkEnabled") {
        await shell("svc", "wifi", action.value ? "enable" : "disable");
        return shell("svc", "data", action.value ? "enable" : "disable");
      }
      for (const scale of ["animator_duration_scale", "transition_animation_scale", "window_animation_scale"]) await shell("settings", "put", "global", scale, action.value ? "0" : "1");
      return;
    case "setOrientation":
      if (!device.id.startsWith("emulator-")) return shell("cmd", "window", "user-rotation", "lock", ROTATION[action.value]);
      await shell("settings", "put", "system", "accelerometer_rotation", "1");
      await shell("cmd", "window", "user-rotation", "free");
      return adb("emu", "sensor", "set", "acceleration", GRAVITY[action.value]);
    case "setLocation":
      return adb("emu", "geo", "fix", String(action.longitude), String(action.latitude));
    case "clearLocation":
      return;
    case "setPermission":
      for (const permission of ANDROID_PERMISSIONS[action.permission]!) {
        await deps.run("adb", ["-s", device.id, "shell", "pm", action.decision === "grant" ? "grant" : "revoke", action.appId, `android.permission.${permission}`], { timeoutMs: 30_000 });
      }
      return;
    case "openUrl":
      return shell("am", "start", "-a", "android.intent.action.VIEW", "-d", action.url);
    case "launchApp":
      return shell("monkey", "-p", action.appId, "-c", "android.intent.category.LAUNCHER", "1");
    case "terminateApp":
      return shell("am", "force-stop", action.appId);
    default:
      throw unsupported(action, "android");
  }
}
