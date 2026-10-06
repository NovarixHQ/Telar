import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";

const homes: string[] = [];
const stores: EngineStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.kernel.executionStore.close();
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

const MARKER = "fyi-intent-migration.json";

function open(home: string): EngineStore {
  const store = new EngineStore(home, () => 1_700_000_000_000);
  stores.push(store);
  return store;
}

function close(store: EngineStore): void {
  store.kernel.executionStore.close();
  stores.splice(stores.indexOf(store), 1);
}

function oldHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-fyi-intent-"));
  homes.push(home);
  fs.writeFileSync(path.join(home, "claude-default-model.json"), JSON.stringify({ model: "claude-opus-5[1m]", at: 1 }));
  const store = open(home);
  store.projectRegistry.register({ id: "project_one", name: "test", root: "/tmp" });
  for (const id of ["session_host", "session_worker", "session_legacy"]) store.lifecycle.createSession({ id, projectId: "project_one" });
  store.intake.submitTurn("session_worker", { runId: "run_source", input: "work" });
  const claimToken = store.claims.claimTurn("session_worker", "worker_one")!.claim!.token;
  store.turnLifecycle.markRunning("session_worker", "run_source", claimToken);
  store.intake.submitAgentTurn("session_host", { runId: "run_note", input: "halfway", intent: "fyi" }, { sessionId: "session_worker", runId: "run_source", claimToken });
  const items = store.queries.items("session_host");
  close(store);

  const db = new Database(path.join(home, "execution.sqlite"));
  const legacy = JSON.stringify({ items }).replaceAll(`ntent":"fyi"`, `ntent":"report"`);
  db.run("INSERT INTO documents(key,value) VALUES(?,?)", ["sessions/session_legacy/items.json", legacy]);
  for (const table of ["items", "turns"]) db.run(`UPDATE ${table} SET value=replace(value,'ntent":"fyi"','ntent":"report"')`);
  db.close();
  fs.rmSync(path.join(home, MARKER), { force: true });
  return home;
}

test("an old store's report intents read back as fyi, rows and documents alike", () => {
  const home = oldHome();
  const store = open(home);
  expect(store.fyiIntentMigration).toBeGreaterThanOrEqual(3);
  const turn = store.queries.turns("session_host").find((each) => each.runId === "run_note");
  expect(turn).toMatchObject({ agentIntent: "fyi", agentDelivery: "passive", notification: { intent: "fyi" } });
  const intents = (sessionId: string) => store.queries.items(sessionId).flatMap((item) => (item.detail.type === "notification" ? [item.detail.notification.intent] : []));
  expect(intents("session_host")).toEqual(["fyi"]);
  expect(intents("session_legacy")).toEqual(["fyi"]);
});

test("it runs once", () => {
  const home = oldHome();
  close(open(home));
  expect(open(home).fyiIntentMigration).toBeUndefined();
});
