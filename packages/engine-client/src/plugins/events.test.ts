import { expect, test } from "bun:test";
import { safeParseEvent } from "../protocol/events";
import { parsePluginEventFrame, PluginEventInput, pluginEventsIn } from "./events";
import { PluginManifest } from "./schema";

const base = { id: 4, at: 1, sessionId: "s1" };

test("a plugin emits to a session, a project or this Mac, and nothing else", () => {
  expect(PluginEventInput.safeParse({ scope: "session", sessionId: "s1", name: "compile.finished", data: { ok: true }, note: { text: "Compiled" } }).success).toBe(true);
  expect(PluginEventInput.safeParse({ scope: "project", projectId: "p1", name: "synced" }).success).toBe(true);
  expect(PluginEventInput.safeParse({ scope: "machine", name: "synced" }).success).toBe(true);
  expect(PluginEventInput.safeParse({ scope: "session", name: "said" }).success).toBe(false);
  expect(PluginEventInput.safeParse({ scope: "everywhere", name: "said" }).success).toBe(false);
  expect(PluginEventInput.safeParse({ scope: "machine", name: "Said Loudly" }).success).toBe(false);
  expect(PluginEventInput.safeParse({ scope: "project", projectId: "p1", name: "synced", note: { text: "no row without a session" } }).success).toBe(false);
});

test("a session's plugin event is a journal event, and a frame of any scope parses", () => {
  const journaled = safeParseEvent({ ...base, type: "plugin.event", pluginId: "latex", scope: "session", name: "compile.started", data: { path: "main.tex" } });
  expect(journaled).toMatchObject({ pluginId: "latex", name: "compile.started" });
  expect(safeParseEvent({ ...base, type: "plugin.event", pluginId: "latex", scope: "project", name: "x", data: null })).toBeNull();
  expect(parsePluginEventFrame({ type: "plugin.event", at: 1, scope: "machine", pluginId: "echo", name: "synced", data: null })).toMatchObject({ scope: "machine" });
  expect(parsePluginEventFrame({ type: "turn.started", sessionId: "s1", id: 1 })).toBeUndefined();
});

test("a manifest's eventKinds are event names", () => {
  const manifest = { id: "echo", api: 1, name: "Echo", version: "1" };
  expect(PluginManifest.safeParse({ ...manifest, eventKinds: ["kernel.state", "said"] }).success).toBe(true);
  expect(PluginManifest.safeParse({ ...manifest, eventKinds: ["Kernel State"] }).success).toBe(false);
});

test("pluginEventsIn folds one plugin's events out of a session's journal", () => {
  const events = [
    { type: "turn.started" },
    { type: "plugin.event", pluginId: "ds", name: "kernel.state", data: { state: "busy" } },
    { type: "plugin.event", pluginId: "latex", name: "compile.started", data: {} },
    { type: "plugin.event", pluginId: "ds", name: "kernel.output", data: {} },
  ];
  expect(pluginEventsIn(events, "ds").map((event) => event.name)).toEqual(["kernel.state", "kernel.output"]);
  expect(pluginEventsIn(events, "ds", "kernel.state").map((event) => event.data)).toEqual([{ state: "busy" }]);
});
