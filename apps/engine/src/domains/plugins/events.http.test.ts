import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { ECHO_MANIFEST, writePlugin } from "../../../test/fixtures/external-plugin";
import { openSessionsStream, readFrames } from "../../../test/sse-frames";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const tempDir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-plugin-events-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function ready() {
  const pluginsDir = tempDir();
  writePlugin(pluginsDir, "echo", { ...ECHO_MANIFEST, eventKinds: ["said", "synced"] });
  const daemon = await startEngine({ models: stubModels, engineRoot: tempDir(), pluginsDir });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  for (const id of ["project_one", "project_off"]) await client.registerProject({ id, name: id, root: tempDir() });
  await client.updateProject("project_one", { plugins: { echo: { enabled: true } } });
  await client.createSession({ id: "session_one", projectId: "project_one" });
  await client.createSession({ id: "session_two", projectId: "project_one" });
  await client.createSession({ id: "session_off", projectId: "project_off" });
  const emit = (emit: Record<string, unknown>) => client.plugin("session_one", "echo", "status", { emit });
  return { daemon, client, emit };
}

const isPluginEvent = (frame: Record<string, unknown>) => frame.type === "plugin.event";

test("an installed plugin's events reach the stream in their scope, and refused ones never do", async () => {
  const { daemon, client, emit } = await ready();
  const stream = await openSessionsStream(daemon);
  try {
    const collected = readFrames(stream.body!, 3, isPluginEvent);
    await emit({ scope: "session", sessionId: "session_one", name: "shouted", data: {} });
    await emit({ scope: "session", sessionId: "session_off", name: "said", data: {} });
    await emit({ scope: "project", projectId: "project_off", name: "synced", data: {} });
    await emit({ scope: "session", sessionId: "session_one", name: "said", data: { text: "hi" }, note: { text: "Said hi" } });
    await emit({ scope: "project", projectId: "project_one", name: "synced", data: { files: 2 } });
    await emit({ scope: "machine", name: "synced" });
    const frames = await collected;

    expect(frames).toEqual([
      expect.objectContaining({ pluginId: "echo", scope: "session", sessionId: "session_one", name: "said", data: { text: "hi" }, note: { text: "Said hi" }, id: expect.any(Number) }),
      expect.objectContaining({ pluginId: "echo", scope: "project", projectId: "project_one", name: "synced", data: { files: 2 } }),
      expect.objectContaining({ pluginId: "echo", scope: "machine", name: "synced", data: null }),
    ]);
  } finally {
    await stream.body?.cancel().catch(() => {});
  }

  const journaled = (sessionId: string) => client.events(sessionId).then((page) => page.events.filter((event) => event.type === "plugin.event"));
  expect(await journaled("session_one")).toEqual([expect.objectContaining({ pluginId: "echo", name: "said", data: { text: "hi" } })]);
  expect(await journaled("session_two")).toEqual([]);
  expect(await journaled("session_off")).toEqual([]);
});
