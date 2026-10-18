/** Generic plugin proxies against a real daemon on a temp home, like `projects-route.test.ts`. */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { GET as machineGet } from "@/app/api/plugins/[plugin]/[...verb]/route";
import { catchAll } from "@/test/catch-all";
import { startEngine, type EngineDaemon } from "../../../../engine/src/daemon";

const savedTelarHome = process.env.TELAR_HOME;
const savedTelarCockpit = process.env.TELAR_COCKPIT;
const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(() => {
  return Promise.all(daemons.splice(0).reverse().map((daemon) => daemon.close())).then(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    if (savedTelarHome === undefined) delete process.env.TELAR_HOME;
    else process.env.TELAR_HOME = savedTelarHome;
    if (savedTelarCockpit === undefined) delete process.env.TELAR_COCKPIT;
    else process.env.TELAR_COCKPIT = savedTelarCockpit;
  });
});

async function ready(): Promise<EngineClient> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-plugin-doors-"));
  roots.push(home);
  process.env.TELAR_HOME = home;
  process.env.TELAR_COCKPIT = "1";
  const daemon = await startEngine({ engineRoot: path.join(home, "engine") });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  fs.mkdirSync(path.join(home, "one"));
  await client.registerProject({ id: "project_one", name: "One", root: path.join(home, "one") });
  return client;
}

describe("generic plugin proxies", () => {
  test("the machine door reaches the plugin's verb", async () => {
    await ready();
    const response = await machineGet(new Request("http://telar.local/api/plugins/latex/managed"), {
      params: Promise.resolve({ plugin: "latex", verb: ["managed"] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("managed");
  });

  test("an unknown plugin is the engine's 404, not the route's", async () => {
    await ready();
    const response = await machineGet(new Request("http://telar.local/api/plugins/nope/anything"), {
      params: Promise.resolve({ plugin: "nope", verb: ["anything"] }),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({ code: "not_found", message: "no plugin nope" });
  });

  test("the project door carries the project, and the engine's gate answers", async () => {
    // `packages` is not a before-enable read, so the refusal proves the id reached the project gate.
    await ready();
    const response = await catchAll(new Request("http://telar.local/api/projects/project_one/plugins/latex/packages"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "invalid_request", message: "latex is not enabled for this project" });
  });

  test("the session door maps a missing session like its neighbours", async () => {
    await ready();
    const response = await catchAll(new Request("http://telar.local/api/sessions/session_missing/plugins/latex/status", { method: "POST", body: "{}" }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });
});
