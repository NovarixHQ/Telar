import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stubModels } from "../test/stub-models";
import { startEngine, type EngineDaemon } from "./daemon";

const roots: string[] = [];
let daemon: EngineDaemon | undefined;

afterEach(async () => {
  await daemon?.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function engine() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cockpit-routes-"));
  roots.push(home);
  daemon = await startEngine({ models: stubModels, engineRoot: path.join(home, "engine") });
  const send = (method: string, route: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${daemon!.discovery.port}${route}`, {
      method,
      headers: { authorization: `Bearer ${daemon!.discovery.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { home, send };
}

test("an appearance the cockpit would not publish is refused", async () => {
  const { send } = await engine();
  expect((await send("PUT", "/v2/appearance", { accent: "rose" })).status).toBe(400);
  expect((await send("GET", "/v2/appearance")).status).toBe(200);
});

test("a workspace file is served as bytes that a browser will not sniff", async () => {
  const { home, send } = await engine();
  const root = path.join(home, "repo");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "note.txt"), "hello");
  await send("POST", "/v2/projects", { id: "project_one", name: "One", root });
  const raw = await send("GET", "/v2/projects/project_one/files/raw?path=note.txt");
  expect(raw.status).toBe(200);
  expect(raw.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await raw.text()).toBe("hello");
});

test("the project-scoped session and instance paths released phones call still work", async () => {
  const { home, send } = await engine();
  await send("POST", "/v2/projects", { id: "project_one", name: "One", root: home });
  const created = await send("POST", "/v2/projects/project_one/sessions", { id: "session_one", title: "Hello" });
  expect(created.status).toBe(201);
  const listed = (await (await send("GET", "/v2/projects/project_one/sessions")).json()) as { sessions: { id: string }[] };
  expect(listed.sessions.map((session) => session.id)).toEqual(["session_one"]);

  const saved = await send("PUT", "/v2/provider-instances", { id: "agent_sample", driver: "acp", displayName: "Sample", binaryPath: "/opt/agents/sample", extraArgs: "--acp" });
  expect(saved.status).toBe(200);
  expect(((await saved.json()) as { providerInstance: { id: string } }).providerInstance.id).toBe("agent_sample");
  expect((await send("PUT", "/v2/provider-instances", { driver: "acp" })).status).toBe(400);
});
