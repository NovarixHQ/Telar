import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanUp, wall, engine, call } from "./test-helpers";

afterEach(cleanUp);

describe("subscribing and answering", () => {
  test("without a self there is nobody to wake: every subscribe mode refuses in words", async () => {
    const { store, projectId } = engine();
    const tools = wall(store);
    const target = store.lifecycle.createSession({ projectId, title: "a target" });
    for (const args of [{ sessionId: target.id }, { cancel: "sub_x" }, {}]) {
      const refused = await call(tools, "sessions_subscribe", args);
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("no session to wake");
    }
  });

  test("a subscription wakes once", async () => {
    const { store, projectId } = engine();
    const host = store.lifecycle.createSession({ projectId, title: "coordinator" });
    const target = store.lifecycle.createSession({ projectId, title: "worker" });
    const tools = wall(store, { sessionId: host.id });
    await call(tools, "sessions_subscribe", { sessionId: target.id });
    for (const runId of ["run_first", "run_second"]) {
      store.intake.submitTurn(target.id, { runId, input: "work" });
      const token = store.claims.claimTurn(target.id, "worker_one")!.claim!.token;
      store.turnLifecycle.markRunning(target.id, runId, token);
      store.turnLifecycle.completeTurn(target.id, runId, token, { text: "done" });
    }
    expect(store.subscriptions.subscriptionsFor(host.id)).toHaveLength(0);
    expect(store.queries.turns(host.id)).toHaveLength(1);
  });

  test("one mode per call: mixed arguments are refused in words and change nothing", async () => {
    const { store, projectId } = engine();
    const host = store.lifecycle.createSession({ projectId, title: "coordinator" });
    const target = store.lifecycle.createSession({ projectId, title: "worker" });
    const tools = wall(store, { sessionId: host.id });
    const made = await call(tools, "sessions_subscribe", { sessionId: target.id });

    const both = await call(tools, "sessions_subscribe", { sessionId: target.id, cancel: made.json!.id });
    expect(both.isError).toBe(true);
    expect(both.text).toContain("not both");
    expect(store.subscriptions.subscriptionsFor(host.id).map((each) => each.id)).toEqual([made.json!.id as string]);

    const empty = await call(tools, "sessions_subscribe", { cancel: made.json!.id });
    expect(empty.json!.removed).toBe(true);
    expect((await call(tools, "sessions_subscribe")).json!.note).toBe("This session is not subscribed to anything.");
  });

  test("a peer cannot restart a human-stopped session or add to its history", async () => {
    const { store, projectId } = engine();
    const host = store.lifecycle.createSession({ projectId, title: "coordinator" });
    const peer = store.lifecycle.createSession({ projectId, title: "peer" });
    store.subscriptions.subscribe(host.id, { targetSessionId: peer.id });
    store.turnLifecycle.stopSession(host.id, "user");
    const tools = wall(store, { sessionId: peer.id });
    expect((await call(tools, "sessions_send", { intent: "task", sessionId: host.id, input: "another update" })).isError).toBe(true);
    store.intake.submitTurn(peer.id, { runId: "run_peer", input: "work" });
    const token = store.claims.claimTurn(peer.id, "worker_one")!.claim!.token;
    store.turnLifecycle.markRunning(peer.id, "run_peer", token);
    store.turnLifecycle.completeTurn(peer.id, "run_peer", token, { text: "done" });
    expect(store.queries.turns(host.id)).toHaveLength(0);
    store.intake.submitTurn(host.id, { runId: "run_human", input: "continue" });
    expect(store.records.get(host.id).agentMessagesBlocked).toBeUndefined();
    expect((await call(tools, "sessions_send", { intent: "task", sessionId: host.id, input: "fresh report" })).isError).not.toBe(true);
    expect(store.queries.turns(host.id)).toHaveLength(2);
  });

  test("subscribe, list, unsubscribe — a round trip that records nothing on either session", async () => {
    const { store, projectId } = engine();
    const host = store.lifecycle.createSession({ projectId, title: "the orchestrator" });
    const tools = wall(store, { sessionId: host.id });
    const target = store.lifecycle.createSession({ projectId, title: "a worker" });

    const subscribed = await call(tools, "sessions_subscribe", { sessionId: target.id });
    expect(subscribed.isError).toBe(false);
    expect(subscribed.json).toMatchObject({ subscriberSessionId: host.id, targetSessionId: target.id, once: true });
    expect(String(subscribed.json!.note)).toContain(`woken once, when ${target.id} ends a turn`);

    const listed = await call(tools, "sessions_subscribe");
    expect((listed.json!.subscriptions as unknown[]).length).toBe(1);

    for (const id of [host.id, target.id]) {
      const stored = fs.readFileSync(path.join(store.paths.sessions, id, "session.json"), "utf8");
      expect(stored).not.toContain(id === host.id ? target.id : host.id);
    }

    const removed = await call(tools, "sessions_subscribe", { cancel: subscribed.json!.id });
    expect(removed.json!.removed).toBe(true);
    const again = await call(tools, "sessions_subscribe", { cancel: subscribed.json!.id });
    expect(again.isError).toBe(false);
    expect(again.json!.removed).toBe(false);
  });

  test("a peer's question is listed with its fields, and answering it is recorded as a session's", async () => {
    const { store, projectId } = engine();
    const host = store.lifecycle.createSession({ projectId, title: "the orchestrator" });
    const tools = wall(store, { sessionId: host.id });
    const target = store.lifecycle.createSession({ projectId, title: "a worker" });
    store.intake.submitTurn(target.id, { runId: "run_t", input: "go" });
    const token = store.claims.claimTurn(target.id, "worker_one")!.claim!.token;
    store.turnLifecycle.markRunning(target.id, "run_t", token);
    store.requestGate.open(target.id, "run_t", token, {
      requestId: "req_q",
      kind: "user_input",
      detail: { kind: "user_input", prompt: "Which database?", fields: [{ key: "db", label: "Database", kind: "choice", choices: ["postgres", "sqlite"] }] },
    });

    const listed = await call(tools, "sessions_requests", { sessionId: target.id });
    expect(listed.isError).toBe(false);
    const [request] = listed.json!.requests as Array<Record<string, unknown>>;
    expect(request).toMatchObject({ id: "req_q", kind: "user_input", prompt: "Which database?" });
    expect((request!.fields as Array<Record<string, unknown>>)[0]).toMatchObject({ key: "db", choices: ["postgres", "sqlite"] });

    const answered = await call(tools, "sessions_requests", { sessionId: target.id, requestId: "req_q", decision: "accept", answers: { db: "postgres" } });
    expect(answered.isError).toBe(false);
    expect(answered.json!.resolvedBy).toBe("session");
    expect(store.requestGate.list(target.id)[0]).toMatchObject({ state: "resolved", decision: "accept", resolvedBy: "session", answers: { db: "postgres" } });
  });

  test("answering needs both halves: a decision without a requestId, or a requestId without a decision, is refused", async () => {
    const { store, projectId } = engine();
    const tools = wall(store);
    const target = store.lifecycle.createSession({ projectId, title: "a worker" });

    const orphan = await call(tools, "sessions_requests", { sessionId: target.id, decision: "accept" });
    expect(orphan.isError).toBe(true);
    expect(orphan.text).toContain("pass its requestId");
    const undecided = await call(tools, "sessions_requests", { sessionId: target.id, requestId: "req_q" });
    expect(undecided.isError).toBe(true);
    expect(undecided.text).toContain("pass a decision");
  });

  test("a secret pick is the user's alone — listed by origin only, refused to resolve", async () => {
    const { store, projectId } = engine();
    const host = store.lifecycle.createSession({ projectId, title: "the orchestrator" });
    const tools = wall(store, { sessionId: host.id });
    const target = store.lifecycle.createSession({ projectId, title: "a worker" });
    store.intake.submitTurn(target.id, { runId: "run_t", input: "go" });
    const token = store.claims.claimTurn(target.id, "worker_one")!.claim!.token;
    store.turnLifecycle.markRunning(target.id, "run_t", token);
    store.requestGate.open(target.id, "run_t", token, {
      requestId: "req_s",
      kind: "secret_access",
      detail: {
        kind: "secret_access",
        secret: { origin: "https://github.com", fields: [{ kind: "password" }], candidates: [{ id: "item_1", title: "GitHub", domain: "github.com" }] },
      },
    });

    const listed = await call(tools, "sessions_requests", { sessionId: target.id });
    expect(listed.text).toContain("https://github.com");
    expect(listed.text).not.toContain("item_1");
    const refused = await call(tools, "sessions_requests", { sessionId: target.id, requestId: "req_s", decision: "accept" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("user's alone");
    expect(store.requestGate.list(target.id)[0]!.state).toBe("open");
  });
});
