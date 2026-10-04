import { describe, expect, test } from "bun:test";
import type { EngineEvent, SessionBootstrap, SessionDelta, SessionSnapshot, Turn } from "@telar/engine-client";
import { envelope, item, turn } from "@/test/journal-fixtures";
import { projectJournal } from "./journal";
import { itemText } from "./journal-items";
import { clearConnections, HEAD_MEMORY_BYTES, heldConnections, HEADS_IN_MEMORY, SessionConnection, sessionConnection } from "./session-connection";
import { hydrateSession, type HydratedSession, type SessionSyncApi } from "./session-sync";
const initial = { session: { id: "session_1" }, turns: [], items: [], tasks: [], requests: [], cursor: 3 } as unknown as SessionSnapshot;
test("surface reads share one hydration and an outage retains projection and cursor atomically", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  let failed = false;
  const api = { session: async () => { reads++; await barrier; return initial; }, events: async () => {
    if (failed) throw new Error("disconnected");
    return { events: [] as EngineEvent[] };
  } };
  const connection = new SessionConnection(api, "session_1");
  const first = connection.read();
  const second = connection.read();
  expect(first).toBe(second);
  release();
  await first;
  expect(reads).toBe(1);
  failed = true;
  await expect(connection.read()).rejects.toThrow("disconnected");
  expect(connection.peek()?.cursor).toBe(3);
  expect(connection.peek()?.session).toEqual(initial.session);
  expect(sessionConnection("host_a", api, "session_1")).toBe(sessionConnection("host_a", api, "session_1"));
  expect(sessionConnection("host_b", api, "session_1")).not.toBe(sessionConnection("host_a", api, "session_1"));
});
test("a companion snapshot ahead of the tail installs its cursor and excludes reflected events", async () => {
  let reads = 0;
  let eventReads = 0;
  const event = { id: 4, type: "turn.stopped", sessionId: "session_1", runId: "run_1", at: 1 } as EngineEvent;
  const connection = new SessionConnection({
    session: async () => ({ ...initial, cursor: ++reads === 1 ? 3 : 5 }),
    events: async () => ({ events: ++eventReads === 1 ? [] : [event] }),
  }, "session_1");
  await connection.read();
  const next = await connection.read();
  expect(next.cursor).toBe(5);
  expect(next.events).toEqual([]);
});

test("a task whose turn left the snapshot window still ends when its completion arrives on the tail", async () => {
  const running = { id: "task_1", sessionId: "session_1", runId: "run_old", kind: "background", backgrounded: true, state: "running", startedAt: 1, updatedAt: 1 };
  const ended = { ...running, state: "completed", updatedAt: 3, completedAt: 3 };
  const stale = { ...running, state: "running", updatedAt: 2 };
  const pages: EngineEvent[][] = [
    [],
    [{ id: 4, type: "task.completed", sessionId: "session_1", runId: "run_new", at: 3, task: ended } as EngineEvent],
    [{ id: 5, type: "task.progress", sessionId: "session_1", runId: "run_new", at: 2, task: stale } as EngineEvent],
  ];
  let reads = 0;
  const connection = new SessionConnection({
    session: async () => ({ ...initial, tasks: reads++ === 0 ? [running] : [] }) as unknown as SessionSnapshot,
    events: async () => ({ events: pages.shift() ?? [] }),
  }, "session_1");
  expect((await connection.read()).tasks.map((task) => task.state)).toEqual(["running"]);
  expect((await connection.read()).tasks.map((task) => task.state)).toEqual(["completed"]);
  expect((await connection.read()).tasks.map((task) => task.state)).toEqual(["completed"]);
});

test("Swift and web consume the same engine-produced OpenCode prefix fixture", async () => {
  const { Session, Item, Turn } = await import("@telar/engine-client");
  const { projectJournal } = await import("./journal");
  const { itemText } = await import("./journal-items");
  const raw = await import("../../../../ios/TelarMobileTests/Fixtures/engine-revision.json");
  const snapshot = { ...raw.default, session: Session.parse(raw.default.session), items: raw.default.items.map((item) => Item.parse(item)), turns: raw.default.turns.map((turn) => Turn.parse(turn)) };
  expect(snapshot.session.driver).toBe("opencode");
  expect(snapshot.turns[1]?.state).toBe("queued");
  const transcript = projectJournal(snapshot.turns, snapshot.items, [], snapshot.tasks);
  expect(itemText(transcript[0]!.items[0]!)).toBe("Hello");
});

describe("opening a session from a cached head", () => {
  const session = { id: "s1", title: "s1" } as unknown as SessionSnapshot["session"];
  const running = turn;
  const settled = { ...turn, state: "completed" } as Turn;
  const journal: EngineEvent[] = [
    { ...envelope, id: 3, type: "content.delta", itemId: "i1", stream: "assistant_text", text: "lo" },
    { ...envelope, id: 4, type: "item.completed", item: item({ id: "i1", status: "completed", detail: { type: "assistant_message", text: "Hello" } }) },
    { ...envelope, id: 5, type: "turn.completed", resultText: "Hello" },
  ];
  const cached = (): HydratedSession => ({
    session, turns: [running], tasks: [], requests: [], events: [], cursor: 2,
    items: [item({ id: "i1", detail: { type: "assistant_message", text: "" }, streamed: "Hel", streamedThrough: 2 })],
  });
  /** What a fresh `/bootstrap` answers once the journal reached `through`. */
  const fresh = (through: number): SessionBootstrap => ({
    session, tasks: [], requests: [], events: [], subscriptions: [], cursor: through,
    turns: [through >= 5 ? settled : running],
    items: [item({ id: "i1", status: "completed", detail: { type: "assistant_message", text: "Hello" } })],
  });
  const view = (head: HydratedSession) =>
    projectJournal(head.turns, head.items, head.events, head.tasks).map((row) => ({
      runId: row.runId, state: row.state, items: row.items.map((entry) => [entry.id, entry.status, itemText(entry)]),
    }));
  function engine(through: number, delta: (after: number) => Promise<SessionDelta>) {
    const asked: string[] = [];
    const api: SessionSyncApi = {
      session: async () => { asked.push("snapshot"); return fresh(through); },
      events: async () => ({ events: [] }),
      sessionBootstrap: async () => { asked.push("bootstrap"); return fresh(through); },
      sessionDelta: (_id, after) => { asked.push(`delta:${after}`); return delta(after); },
    };
    return { api, asked };
  }
  const answer = (through: number) => async (after: number): Promise<SessionDelta> => {
    const events = journal.filter((event) => event.id > after && event.id <= through);
    return { reset: false, events, cursor: Math.max(after, ...events.map((event) => event.id)) };
  };

  test("applies the delta, and the transcript equals a fresh load", async () => {
    const { api, asked } = engine(4, answer(4));
    const connection = new SessionConnection(api, "s1");
    connection.seed(cached(), 1);
    const reconciled = await connection.open();
    expect(asked).toEqual(["delta:2"]);
    expect(reconciled.cursor).toBe(4);
    expect(view(reconciled)).toEqual(view(await hydrateSession(api, "s1")));
  });

  test("a delta that ends a turn re-reads the snapshot and still equals a fresh load", async () => {
    const { api, asked } = engine(5, answer(5));
    const connection = new SessionConnection(api, "s1");
    connection.seed(cached(), 1);
    const reconciled = await connection.open();
    expect(asked).toEqual(["delta:2", "snapshot"]);
    expect(view(reconciled)).toEqual(view(await hydrateSession(api, "s1")));
    expect(view(reconciled)[0]!.state).toBe("completed");
  });

  test("a gap the engine calls too large resets to a fresh bootstrap", async () => {
    const { api, asked } = engine(5, async () => ({ reset: true }));
    const connection = new SessionConnection(api, "s1");
    connection.seed(cached(), 1);
    const reconciled = await connection.open();
    expect(asked).toEqual(["delta:2", "bootstrap"]);
    expect(reconciled.cursor).toBe(5);
    expect(view(reconciled)).toEqual(view(await hydrateSession(api, "s1")));
  });

  test("an engine without the delta route also resets", async () => {
    const { api, asked } = engine(5, async () => { throw new Error("not found"); });
    const connection = new SessionConnection(api, "s1");
    connection.seed(cached(), 1);
    expect((await connection.open()).cursor).toBe(5);
    expect(asked).toEqual(["delta:2", "bootstrap"]);
  });

  test("an unchanged session keeps the cached head as is", async () => {
    const { api } = engine(2, answer(2));
    const connection = new SessionConnection(api, "s1");
    const head = cached();
    connection.seed(head, 1);
    expect(await connection.open()).toBe(head);
  });
});

describe("heads held in memory", () => {
  const api: SessionSyncApi = { session: async () => initial, events: async () => ({ events: [] }) };
  const head = (bytes: number): HydratedSession =>
    ({ ...initial, session: { id: "x", title: "x".repeat(bytes) }, events: [], cursor: 3 }) as unknown as HydratedSession;

  test("keep the 16 most recently used", () => {
    clearConnections();
    for (let index = 0; index <= HEADS_IN_MEMORY; index += 1) sessionConnection("local", api, `s${index}`);
    expect(heldConnections()).toHaveLength(HEADS_IN_MEMORY);
    expect(heldConnections()[0]).toBe(JSON.stringify(["local", "s1", null]));
  });

  test("evict the least recently used past the byte cap, never the newest", () => {
    clearConnections();
    const quarter = HEAD_MEMORY_BYTES / 4;
    for (let index = 0; index < 4; index += 1) sessionConnection("local", api, `big${index}`).seed(head(quarter), 1);
    expect(heldConnections()).toHaveLength(3);
    expect(heldConnections()).not.toContain(JSON.stringify(["local", "big0", null]));
    sessionConnection("local", api, "huge").seed(head(HEAD_MEMORY_BYTES * 2), 1);
    expect(heldConnections()).toEqual([JSON.stringify(["local", "huge", null])]);
  });
});
