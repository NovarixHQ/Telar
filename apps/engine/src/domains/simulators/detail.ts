import type { SimulatorConfiguration, SimulatorDetail, SimulatorSummary } from "@telar/engine-client";
import type { ActionDeps } from "./actions";
import { IOS_TEXT_SIZES } from "./actions";

type TextSize = NonNullable<SimulatorConfiguration["textSize"]>;
type AxStatus = Partial<Record<"reduce-motion" | "reduce-transparency" | "show-borders" | "voiceover" | "liquid-glass" | "color-filter", string>>;

export function iosTextSize(category: string): TextSize {
  const exact = (Object.entries(IOS_TEXT_SIZES) as Array<[TextSize, string]>).find(([, value]) => value === category);
  if (exact) return exact[0];
  if (category.startsWith("accessibility")) return "extra-large";
  if (category.includes("extra")) return "large";
  return ["extra-small", "small", "medium"].includes(category) ? "small" : "default";
}

function androidTextSize(scale: number): TextSize {
  if (scale <= 0.9) return "small";
  if (scale >= 1.25) return "extra-large";
  return scale >= 1.1 ? "large" : "default";
}

const FOCUS = /m(?:CurrentFocus|FocusedApp)=\w+\{[^ ]+ u\d+ ([^/ ]+)\//;

export async function readDetail(deps: ActionDeps, device: SimulatorSummary, now: number): Promise<SimulatorDetail> {
  const read = async (file: string, args: string[]) => {
    const result = await deps.run(file, args, { timeoutMs: 15_000 }).catch(() => undefined);
    return result?.code === 0 ? result.stdout.trim() : undefined;
  };
  const configuration: SimulatorConfiguration = {};
  let foregroundApp: SimulatorDetail["foregroundApp"] = null;
  if (device.platform === "ios") {
    const ui = (setting: string) => read("xcrun", ["simctl", "ui", device.id, setting]);
    const helper = deps.helpers().axSettings;
    const [appearance, size, contrast, ax] = await Promise.all([ui("appearance"), ui("content_size"), ui("increase_contrast"), helper ? read("xcrun", ["simctl", "spawn", device.id, helper, "status"]) : undefined]);
    if (appearance === "light" || appearance === "dark") configuration.appearance = appearance;
    if (size) configuration.textSize = iosTextSize(size);
    if (contrast === "enabled" || contrast === "disabled") configuration.increaseContrast = contrast === "enabled";
    let status: AxStatus = {};
    try {
      status = ax ? (JSON.parse(ax) as AxStatus) : {};
    } catch {}
    const on = (value: string | undefined) => (value === undefined ? undefined : value === "on");
    const toggles = { reduceMotion: on(status["reduce-motion"]), reduceTransparency: on(status["reduce-transparency"]), showBorders: on(status["show-borders"]), voiceOver: on(status.voiceover) };
    for (const [key, value] of Object.entries(toggles)) if (value !== undefined) configuration[key as keyof typeof toggles] = value;
    if (status["liquid-glass"] === "clear" || status["liquid-glass"] === "tinted") configuration.liquidGlass = status["liquid-glass"];
    if (status["color-filter"] && ["none", "grayscale", "red-green", "green-red", "blue-yellow"].includes(status["color-filter"])) configuration.colorFilter = status["color-filter"] as SimulatorConfiguration["colorFilter"];
  } else {
    const shell = (...args: string[]) => read("adb", ["-s", device.id, "shell", ...args]);
    const [night, scale, animator, wifi, windows] = await Promise.all([
      shell("cmd", "uimode", "night"),
      shell("settings", "get", "system", "font_scale"),
      shell("settings", "get", "global", "animator_duration_scale"),
      shell("settings", "get", "global", "wifi_on"),
      shell("dumpsys", "window"),
    ]);
    if (night?.includes("yes")) configuration.appearance = "dark";
    else if (night?.includes("no")) configuration.appearance = "light";
    if (scale && Number.isFinite(Number(scale))) configuration.textSize = androidTextSize(Number(scale));
    if (animator && Number.isFinite(Number(animator))) configuration.reduceMotion = Number(animator) === 0;
    if (wifi === "1" || wifi === "0") configuration.networkEnabled = wifi === "1";
    const focused = windows ? FOCUS.exec(windows)?.[1] : undefined;
    if (focused) foregroundApp = { id: focused };
  }
  return { id: device.id, configuration, foregroundApp, readAt: now };
}
