import fs from "node:fs";
import { EngineClient } from "@telar/engine-client";
import { startEngine } from "../src/daemon";
import { stubModels } from "../test/stub-models";
import { engineHome, removeTmp, repo } from "../test/worktree-fixtures";

const SESSION = "/v2/sessions/session_compat";
const PATHS = [
  "/v2/ping",
  "/v2/health",
  "/v2/identity",
  "/v2/remote",
  "/v2/sessions/live",
  "/v2/sessions/live?all=1",
  "/v2/sidebar-layout",
  "/v2/push/read-state?ids=session_compat",
  "/v2/projects/project_compat/git",
  "/v2/simulators",
  SESSION,
  ...["bootstrap", "children", "subscriptions", "diff", "run/configs", "run/status", "events?after=0"].map((tail) => `${SESSION}/${tail}`),
];

const daemon = await startEngine({ models: stubModels, engineRoot: engineHome("telar-fixture-"), workerLeaseMs: 60_000, notifier: () => true });
const client = new EngineClient(daemon.discovery);
const root = repo();
await client.registerProject({ id: "project_compat", name: "Compat", root });
await client.createSession({ id: "session_compat", projectId: "project_compat", envMode: "local" });

const answers: Record<string, { status: number; body: unknown }> = {};
for (const path of PATHS) {
  const response = await fetch(`http://${daemon.discovery.host}:${daemon.discovery.port}${path}`, { headers: { authorization: `Bearer ${daemon.discovery.token}` } });
  answers[path] = { status: response.status, body: await response.json().catch(() => null) };
}
const health = answers["/v2/health"]?.body as Record<string, unknown>;
Object.assign(health, { hostname: "compat.lan", plugins: undefined, eventLoop: undefined, git: undefined });
const scrubbed = JSON.stringify(answers, null, 1).replaceAll(fs.realpathSync(root), "/tmp/compat").replaceAll(root, "/tmp/compat");
fs.writeFileSync(process.argv[2] ?? "host.json", `${scrubbed}\n`);
await daemon.close();
removeTmp();
process.exit(0);
