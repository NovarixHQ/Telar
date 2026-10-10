import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, type EngineClientError } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../src/daemon";
import { stubModels } from "../../test/stub-models";
import { STUB_CAPABILITIES } from "../../test/stub-driver";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-ds-module-"));
  roots.push(directory);
  return directory;
};

afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test("a daemon with no embedded worker has no kernels, as before", async () => {
  const daemon = await startEngine({ models: stubModels, engineRoot: root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.registerProject({ id: "project_one", name: "One", root: root() });
  await client.updateProject("project_one", {
    // @ts-expect-error deprecated alias the engine still accepts
    dataScience: { enabled: true, python: { source: "chosen", path: "/bin/ls", resolvedAt: Date.now() } },
  });
  await client.createSession({ id: "session_one", projectId: "project_one" });
  const refused = await client.plugin("session_one", "data-science", "kernel", {}).catch((error: EngineClientError) => error);
  expect((refused as EngineClientError).message).toContain("this engine has no kernel host");
});

test("a daemon with an embedded worker lends the module a process host", async () => {
  const daemon = await startEngine({
    models: stubModels,
    engineRoot: root(),
    embeddedWorker: { createDriver: () => ({ capabilities: STUB_CAPABILITIES, run: async () => ({ text: "ok" }) }), pollMs: 20 },
  });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.registerProject({ id: "project_one", name: "One", root: root() });
  await client.updateProject("project_one", {
    // @ts-expect-error deprecated alias the engine still accepts
    dataScience: { enabled: true, python: { source: "chosen", path: "/bin/ls", resolvedAt: Date.now() } },
  });
  await client.createSession({ id: "session_one", projectId: "project_one" });
  // The host exists, so the kernel verb reaches it and answers rather than
  // refusing — a session with no kernel started reports its state.
  const answer = await client.plugin<{ state?: string }>("session_one", "data-science", "kernel", {});
  expect(answer).toBeDefined();
});
