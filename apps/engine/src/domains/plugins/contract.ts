import type { PluginMeta } from "@telar/engine-client";
import type { z } from "zod";
import type { PluginWorkLog } from "./work-log";
import type { PluginMachineRoutes, PluginProjectRoutes } from "./scoped-routes";

export const PLUGIN_INIT_TIMEOUT_MS = 10_000;

export const PLUGIN_DISPOSE_TIMEOUT_MS = 5_000;

export type PluginInitContext = {
  daemonId: string;
  stateDir: string;
  work: PluginWorkLog;
  onDispose(name: string, cleanup: () => void | Promise<void>): void;
};

export type PluginDisposeReason = "shutdown" | "disabled" | "init_failed" | "replaced";

type PluginScopeHooks = {
  drain?(projectId: string, reason: PluginDisposeReason): void | Promise<void>;
  busy?(projectId: string): boolean;
  releaseProject?(projectId: string): void | Promise<void>;
  releaseSession?(sessionId: string, reason: string): void | Promise<void>;
};

export type PluginEngineModule<Settings = unknown> = {
  meta: PluginMeta;
  settingsSchema?: z.ZodType<Settings>;
  machineSettingsSchema?: z.ZodType<unknown>;
  publishedSettingsSchema?: Record<string, unknown>;
  publishedMachineSettingsSchema?: Record<string, unknown>;
  installed?: { linked: boolean };
  init?(context: PluginInitContext): void | Promise<void>;
  hooks?: PluginScopeHooks;
  routes?: Record<string, (input: Record<string, unknown>, capability: unknown) => unknown | Promise<unknown>>;
  projectRoutes?: PluginProjectRoutes;
  machineRoutes?: PluginMachineRoutes;
  resolve?(sessionId: string): unknown;
  assets?(asset: string): string | undefined;
  /** Whether a session can use the plugin now; a turn leaves out the tools of one that cannot. */
  available?(sessionId: string): boolean;
  processes?(): { key: string; pid?: number; startedAt: number; alive: boolean }[];
};

export type PluginRecord = {
  module: PluginEngineModule;
  state: "ready" | "failed" | "disposed";
  error?: string;
  initMs?: number;
  cleanups: { name: string; run: () => void | Promise<void> }[];
};

