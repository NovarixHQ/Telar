import type { PluginEventInput, PluginManifestInput } from "@telar/engine-client";
import type { z } from "zod";

/** A session the plugin is on for, with the project's settings and this Mac's, each as stored. */
export type PluginSession = {
  sessionId: string;
  projectId: string;
  /** The session's own tree: its worktree, or the project's checkout. */
  cwd: string;
  settings: Record<string, unknown>;
  machine: Record<string, unknown>;
};

export type PluginProject = {
  projectId: string;
  root: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  machine: Record<string, unknown>;
};

type PluginRequest = {
  input: Record<string, unknown>;
  query: URLSearchParams;
  params: Record<string, string>;
};

export type PluginRoute<Scope> = {
  status?: 200 | 202;
  /** Answers on a project that has not turned the plugin on yet. */
  beforeEnable?: boolean;
  handle(request: PluginRequest, scope: Scope): unknown;
};

export type PluginToolAnswer = { content: { type: "text"; text: string }[]; isError?: boolean };

/** What the engine lends a module plugin. Settings writes go through the same validation as the cockpit's. */
export type PluginHost = {
  /** `<TELAR_HOME>/engine/plugins/<id>`, created on demand. */
  stateDir: string;
  /** The engine's data root, for state a plugin kept there before it had a `stateDir`. */
  engineRoot: string;
  now(): number;
  /** Emits one of the manifest's `eventKinds`: journaled on a session, live only on a project or this Mac. */
  emit(event: PluginEventInput): void;
  machineSettings(): Record<string, unknown>;
  project(projectId: string): PluginProject;
  writeProjectSettings(projectId: string, settings: Record<string, unknown>): void;
  writeMachineSettings(settings: Record<string, unknown>): void;
  /** A short model completion on the engine's cheap model: no tools, no session. Capped, timed out and counted in usage. */
  complete(request: { prompt: string; system?: string; maxChars?: number; timeoutMs?: number }): Promise<{ text: string }>;
};

export type PluginEngine = {
  /** One handler per tool the manifest declares, by name. */
  tools?: Record<string, (args: Record<string, unknown>, session: PluginSession) => Promise<PluginToolAnswer>>;
  /** One handler per session verb the manifest declares. */
  session?: Record<string, (input: Record<string, unknown>, session: PluginSession) => unknown>;
  project?: Record<string, PluginRoute<PluginProject>>;
  machine?: Record<string, PluginRoute<Record<string, never>>>;
  busy?(): boolean;
  releaseSession?(sessionId: string): void;
  dispose?(): void | Promise<void>;
};

/** A plugin that ships with the app: its manifest, and the module the engine loads in-process. */
export type BundledPlugin = {
  manifest: PluginManifestInput;
  /** Stricter checks than the manifest's JSON Schema can say; the manifest's schema is what clients see. */
  settingsSchema?: z.ZodType<unknown>;
  machineSettingsSchema?: z.ZodType<unknown>;
  engine(host: PluginHost): PluginEngine;
};

export function textAnswer(text: string, isError = false): PluginToolAnswer {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}
