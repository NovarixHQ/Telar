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

test("the cockpit is served without credentials on loopback and on the network listener, and the API still is not", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-static-daemon-"));
  roots.push(home);
  const staticDir = path.join(home, "out");
  fs.mkdirSync(path.join(staticDir, "projects/_/sessions"), { recursive: true });
  fs.writeFileSync(path.join(staticDir, "projects/_/sessions/_.html"), "<p>session</p>");
  daemon = await startEngine({ models: stubModels, engineRoot: path.join(home, "engine"), network: { host: "127.0.0.1" }, staticDir });

  for (const port of [daemon.discovery.port, daemon.network!.port]) {
    const base = `http://127.0.0.1:${port}`;
    expect(await (await fetch(`${base}/projects/p/sessions/s`)).text()).toBe("<p>session</p>");
    expect((await fetch(`${base}/v2/sessions`)).status).toBe(401);
  }
});
