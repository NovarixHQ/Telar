import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";
import { DELTA_MAX_EVENTS, sessionDelta } from "./delta";

const roots: string[] = [];
const stores: EngineStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.kernel.executionStore.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function streaming(deltas: number, text = (index: number) => `chunk-${index} `) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-delta-"));
  roots.push(home);
  const store = new EngineStore(home, Date.now);
  stores.push(store);
  store.projectRegistry.register({ id: "project_one", name: "One", root: "/tmp" });
  store.lifecycle.createSession({ id: "session_one", projectId: "project_one" });
  store.intake.submitTurn("session_one", { runId: "run_one", input: "stream" });
  const token = store.claims.claimTurn("session_one", "worker_one")!.claim!.token;
  store.turnLifecycle.markRunning("session_one", "run_one", token);
  store.ingest.ingestObservations("session_one", "run_one", token, [
    { kind: "item.started", item: { id: "item_one", detail: { type: "assistant_message", text: "" } } },
  ]);
  for (let index = 0; index < deltas; index += 1) {
    store.ingest.ingestObservations("session_one", "run_one", token, [{ kind: "content.delta", itemId: "item_one", stream: "assistant_text", text: text(index) }]);
  }
  return store;
}

test("a small gap answers with exactly the journal above the cursor", () => {
  const store = streaming(10);
  const cursor = store.queries.eventCursor("session_one");
  const after = cursor - 4;
  expect(sessionDelta(store, "session_one", after)).toEqual({ reset: false, events: store.queries.readEvents("session_one", after), cursor });
  expect(sessionDelta(store, "session_one", cursor)).toEqual({ reset: false, events: [], cursor });
});

test("more events than a delta carries asks for a fresh bootstrap", () => {
  const store = streaming(DELTA_MAX_EVENTS + 10);
  const cursor = store.queries.eventCursor("session_one");
  expect(sessionDelta(store, "session_one", cursor - DELTA_MAX_EVENTS).reset).toBe(false);
  expect(sessionDelta(store, "session_one", cursor - DELTA_MAX_EVENTS - 1)).toEqual({ reset: true });
});

test("a few events over a megabyte ask for a fresh bootstrap", () => {
  const store = streaming(3, () => "x".repeat(400_000));
  expect(sessionDelta(store, "session_one", 0)).toEqual({ reset: true });
});

test("a cursor this journal never reached is someone else's, so it resets", () => {
  const store = streaming(2);
  expect(sessionDelta(store, "session_one", store.queries.eventCursor("session_one") + 1)).toEqual({ reset: true });
});

test("a cursor below the retention floor lost events, so it resets", () => {
  const store = streaming(2);
  const cursor = store.queries.eventCursor("session_one");
  store.kernel.executionStore.setMetadata("journal-floor/session_one", String(cursor));
  expect(sessionDelta(store, "session_one", cursor - 1)).toEqual({ reset: true });
  expect(sessionDelta(store, "session_one", cursor).reset).toBe(false);
});
