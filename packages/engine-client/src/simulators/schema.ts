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
});
export type SimulatorSummary = z.infer<typeof SimulatorSummary>;

export const SimulatorPlatformAvailability = z.object({
  platform: SimulatorPlatform,
  available: z.boolean(),
  reason: z.string().optional(),
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
