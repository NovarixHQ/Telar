import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { POST } from "./route";
import { startEngine, type EngineDaemon } from "../../../../../../../../engine/src/daemon";

const savedTelarHome = process.env.TELAR_HOME;
const savedTelarCockpit = process.env.TELAR_COCKPIT;
const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (savedTelarHome === undefined) delete process.env.TELAR_HOME;
  else process.env.TELAR_HOME = savedTelarHome;
  if (savedTelarCockpit === undefined) delete process.env.TELAR_COCKPIT;
  else process.env.TELAR_COCKPIT = savedTelarCockpit;
});

test("the cockpit forwards a message's inline code to the engine and gets back the files it names", async () => {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "telar-references-route-")));
  roots.push(home);
  process.env.TELAR_HOME = home;
  process.env.TELAR_COCKPIT = "1";
  const checkout = path.join(home, "one");
  fs.mkdirSync(path.join(checkout, "packages/ui/src/shell"), { recursive: true });
  fs.writeFileSync(path.join(checkout, "packages/ui/src/shell/app-shell.tsx"), "x\n");
  const daemon = await startEngine({ engineRoot: path.join(home, "engine") });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.registerProject({ id: "project_one", name: "One", root: checkout });
  await client.createSession({ id: "session_one", projectId: "project_one" });

  const response = await POST(
    new Request("http://telar.local/api/sessions/session_one/files/references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: ["packages/ui/src/shell/app-shell.tsx:12", "app-shell.tsx", "missing.ts"] }),
    }),
    { params: Promise.resolve({ sessionId: "session_one" }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    references: [
      { text: "packages/ui/src/shell/app-shell.tsx:12", path: "packages/ui/src/shell/app-shell.tsx", line: 12 },
      { text: "app-shell.tsx", path: "packages/ui/src/shell/app-shell.tsx" },
    ],
  });
});
