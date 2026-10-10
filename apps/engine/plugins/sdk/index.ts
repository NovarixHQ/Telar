import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { PluginEventInput, PluginManifestInput, TurnAttachment, WorkspaceFile, WorkspaceWriteResult } from "@telar/engine-client";
import type { z } from "zod";

export { atomicWrite } from "../../src/platform/fs/atomic";
export { capabilityTools, err, failure, json, ok, type ToolFactory } from "./tools";

/** A session the plugin is on for, with the project's settings and this Mac's, each as stored. */
export type PluginSession = {
  sessionId: string;
  projectId: string;
  /** The session's own tree: its worktree, or the project's checkout. */
  cwd: string;
  /** The worktree's folder name, when the session has its own. */
  worktree?: string;
  /** The plugin's folder for this session (`sessionStateDir`), created on demand. */
  stateDir: string;
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

export type PluginProcessSpec = { command: string; args?: string[]; cwd: string; env?: Record<string, string | undefined> };

export type PluginProcessInfo = { key: string; pid?: number; startedAt: number; alive: boolean };

/** Long-lived children the module owns. All are stopped when the plugin is disabled or the engine stops. */
export type PluginProcesses = {
  start(key: string, spec: PluginProcessSpec): ChildProcessWithoutNullStreams;
  /** Reaps a grandchild with its parent, including after an engine crash. */
  adopt(key: string, pid: number): void;
  list(): PluginProcessInfo[];
  restart(key: string): Promise<ChildProcessWithoutNullStreams>;
  /** SIGTERM, then SIGKILL after `graceMs`. */
  stop(key: string, graceMs?: number): Promise<void>;
};

type PluginAttachmentInput = { name: string; mediaType: string; data: Uint8Array; tags?: string[]; producer?: string; title?: string };

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
  /** Files a plugin produces, kept with the session and listed beside the person's own. */
  attachments: {
    put(sessionId: string, input: PluginAttachmentInput): TurnAttachment;
    bytes(sessionId: string, attachmentId: string): Uint8Array;
  };
  /** Reads and writes fenced inside `root`; a write carries the hash it expects on disk. */
  files: {
    read(root: string, target: string, maxBytes?: number): WorkspaceFile;
    write(root: string, target: string, text: string, expectedSha256: string, maxBytes?: number): WorkspaceWriteResult;
    ignore(root: string, rule: { rule: string; why: string; alreadyCovered?: string[] }): void;
  };
  /** Absent on an engine that runs no turns. */
  processes?: PluginProcesses;
};

export type PluginEngine = {
  /** One handler per tool the manifest declares, by name. */
  tools?: Record<string, (args: Record<string, unknown>, session: PluginSession) => Promise<PluginToolAnswer>>;
  /** One handler per session verb the manifest declares. */
  session?: Record<string, (input: Record<string, unknown>, session: PluginSession) => unknown>;
  project?: Record<string, PluginRoute<PluginProject>>;
  machine?: Record<string, PluginRoute<Record<string, never>>>;
  /** Whether a session can use the plugin now; when false its tools are left out of the turn. */
  available?(session: PluginSession): boolean;
  busy?(projectId: string): boolean;
  /** The project turned the plugin off. */
  releaseProject?(projectId: string): void | Promise<void>;
  /** The session was archived or deleted; `session` is absent when it no longer resolves. */
  releaseSession?(sessionId: string, reason: string, session?: Omit<PluginSession, "settings" | "machine">): void | Promise<void>;
  dispose?(): void | Promise<void>;
};

/** A plugin that ships with the app: its manifest, and the module the engine loads in-process. */
export type BundledPlugin = {
  manifest: PluginManifestInput;
  /** Stricter checks than the manifest's JSON Schema can say; the manifest's schema is what clients see. */
  settingsSchema?: z.ZodType<unknown>;
  machineSettingsSchema?: z.ZodType<unknown>;
  assets?: Readonly<Record<string, string>>;
  engine(host: PluginHost): PluginEngine;
};

/** Thrown by a route for something that does not exist; the door answers 404 instead of 400. */
export class PluginNotFoundError extends Error {}

export function textAnswer(text: string, isError = false): PluginToolAnswer {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}
