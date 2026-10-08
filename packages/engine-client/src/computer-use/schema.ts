import { z } from "zod";
import { BUILT_IN_DRIVERS, type ProviderDriverKind } from "../protocol/common";

export const ComputerUsePermission = z.enum(["granted", "denied", "unauthenticated", "host-not-running", "unknown"]);
export type ComputerUsePermission = z.infer<typeof ComputerUsePermission>;

export const ComputerUseBackend = z.enum(["cua"]);
export type ComputerUseBackend = z.infer<typeof ComputerUseBackend>;

export const COMPUTER_USE_DRIVERS: readonly ProviderDriverKind[] = BUILT_IN_DRIVERS;

export function driverTakesComputerUse(driver: ProviderDriverKind): boolean {
  return COMPUTER_USE_DRIVERS.includes(driver);
}

export const ComputerUseServer = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
});
export type ComputerUseServer = z.infer<typeof ComputerUseServer>;

export const ComputerUsePane = z.enum(["accessibility", "screen-recording"]);
export type ComputerUsePane = z.infer<typeof ComputerUsePane>;

export const ComputerUseStatus = z.object({
  installed: z.boolean(),
  hostRunning: z.boolean(),
  bundled: z.boolean().optional(),
  backend: ComputerUseBackend.optional(),
  permission: ComputerUsePermission.optional(),
  message: z.string().optional(),
  missing: z.array(ComputerUsePane).optional(),
});
export type ComputerUseStatus = z.infer<typeof ComputerUseStatus>;

export const ComputerUseGrant = z.object({
  started: z.boolean(),
  backend: ComputerUseBackend.optional(),
  daemon: z.boolean().optional(),
  prompted: z.boolean().optional(),
  permission: ComputerUsePermission.optional(),
  opened: ComputerUsePane.optional(),
  message: z.string().optional(),
});
export type ComputerUseGrant = z.infer<typeof ComputerUseGrant>;
