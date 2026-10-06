import { z } from "zod";

export const SimulatorPlatform = z.enum(["ios", "android"]);
export type SimulatorPlatform = z.infer<typeof SimulatorPlatform>;

export const SimulatorId = z.string().trim().min(1).max(256);

export const SimulatorSummary = z.object({
  id: SimulatorId,
  platform: SimulatorPlatform,
  name: z.string().trim().min(1),
  version: z.string(),
  booted: z.boolean(),
  physical: z.boolean(),
  pairedWith: SimulatorId.optional(),
});
export type SimulatorSummary = z.infer<typeof SimulatorSummary>;

export const SimulatorPlatformAvailability = z.object({
  platform: SimulatorPlatform,
  available: z.boolean(),
  reason: z.string().optional(),
  detail: z.string().optional(),
});
export type SimulatorPlatformAvailability = z.infer<typeof SimulatorPlatformAvailability>;

export const SimulatorToolVersion = z.object({
  requiredVersion: z.string(),
  installedVersions: z.array(z.string()),
  runningVersion: z.string().nullable(),
});
export type SimulatorToolVersion = z.infer<typeof SimulatorToolVersion>;

export const SimulatorHubStatus = z.enum(["disabled", "idle", "installing", "starting", "ready", "failed"]);
export type SimulatorHubStatus = z.infer<typeof SimulatorHubStatus>;

export const SimulatorsState = z.object({
  status: SimulatorHubStatus,
  detail: z.string().optional(),
  hub: SimulatorToolVersion,
  platforms: z.array(SimulatorPlatformAvailability),
  simulators: z.array(SimulatorSummary),
  errors: z.array(z.string()),
});
export type SimulatorsState = z.infer<typeof SimulatorsState>;

export const SimulatorBootFailure = z.enum(["disk_space", "timeout", "launch_failed"]);
export type SimulatorBootFailure = z.infer<typeof SimulatorBootFailure>;

export const SimulatorAppearance = z.enum(["light", "dark"]);
export const SimulatorTextSize = z.enum(["small", "default", "large", "extra-large"]);
export const SimulatorColorFilter = z.enum(["none", "grayscale", "red-green", "green-red", "blue-yellow"]);
export const SimulatorOrientation = z.enum(["portrait", "landscape_left", "portrait_upside_down", "landscape_right"]);
export const SimulatorLiquidGlass = z.enum(["clear", "tinted"]);
export const SimulatorToggle = z.enum(["reduceMotion", "increaseContrast", "reduceTransparency", "showBorders", "voiceOver", "networkEnabled"]);
export type SimulatorToggle = z.infer<typeof SimulatorToggle>;
export const SimulatorPermission = z.enum(["camera", "microphone", "photos", "contacts", "calendar", "reminders", "location", "notifications", "motion", "media-library", "faceid"]);
export type SimulatorPermission = z.infer<typeof SimulatorPermission>;

export const SimulatorConfiguration = z.object({
  appearance: SimulatorAppearance.optional(),
  textSize: SimulatorTextSize.optional(),
  reduceMotion: z.boolean().optional(),
  increaseContrast: z.boolean().optional(),
  reduceTransparency: z.boolean().optional(),
  showBorders: z.boolean().optional(),
  voiceOver: z.boolean().optional(),
  liquidGlass: SimulatorLiquidGlass.optional(),
  colorFilter: SimulatorColorFilter.optional(),
  networkEnabled: z.boolean().optional(),
});
export type SimulatorConfiguration = z.infer<typeof SimulatorConfiguration>;

export const SimulatorDetail = z.object({
  id: SimulatorId,
  configuration: SimulatorConfiguration,
  foregroundApp: z.object({ id: z.string() }).nullable(),
  readAt: z.number(),
});
export type SimulatorDetail = z.infer<typeof SimulatorDetail>;

const appId = z.string().trim().min(1).max(256);

export const SimulatorAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setAppearance"), value: SimulatorAppearance }),
  z.object({ type: z.literal("setTextSize"), value: SimulatorTextSize }),
  z.object({ type: z.literal("setToggle"), setting: SimulatorToggle, value: z.boolean() }),
  z.object({ type: z.literal("setLiquidGlass"), value: SimulatorLiquidGlass }),
  z.object({ type: z.literal("setColorFilter"), value: SimulatorColorFilter }),
  z.object({ type: z.literal("setOrientation"), value: SimulatorOrientation }),
  z.object({ type: z.literal("setLocation"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  z.object({ type: z.literal("clearLocation") }),
  z.object({ type: z.literal("setPermission"), appId, permission: SimulatorPermission, decision: z.enum(["grant", "revoke", "reset"]) }),
  z.object({ type: z.literal("openUrl"), url: z.string().url().max(4096) }),
  z.object({ type: z.literal("launchApp"), appId }),
  z.object({ type: z.literal("terminateApp"), appId }),
  z.object({ type: z.literal("sendPush"), appId, payload: z.union([z.string().min(1).max(4096), z.record(z.string(), z.unknown())]) }),
]);
export type SimulatorAction = z.infer<typeof SimulatorAction>;

const unit = z.number().min(0).max(1);

export const SimulatorInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("touch"), phase: z.enum(["begin", "move", "end"]), x: unit, y: unit }),
  z.object({ type: z.literal("button"), button: z.enum(["home", "app_switcher", "lock"]) }),
  z.object({ type: z.literal("key"), phase: z.enum(["down", "up"]), usage: z.number().int().min(0).max(0xffff) }),
  z.object({ type: z.literal("orientation"), orientation: SimulatorOrientation }),
  z.object({ type: z.literal("keyboard"), enabled: z.boolean() }),
]);
export type SimulatorInput = z.infer<typeof SimulatorInput>;

export const MAX_SIMULATOR_INPUT_EVENTS = 64;

export const SimulatorStreamTicket = z.object({ ticket: z.string(), expiresAt: z.number() });
export type SimulatorStreamTicket = z.infer<typeof SimulatorStreamTicket>;
