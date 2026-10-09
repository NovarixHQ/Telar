import { describe, expect, test } from "bun:test";
import type http from "node:http";
import type { EngineClient } from "@telar/engine-client";
import { matchRoute } from "../../platform/http/router";
import {
  DESKTOP_APPROVE, DESKTOP_APPROVED, DESKTOP_DISMISS, DESKTOP_NOTICE,
  createDesktopStream, desktopAttached, desktopNotices, dismissDesktop, emptyDesktopState, handleDesktopMessage, notifyDesktop,
  type DesktopState,
} from "./desktop";
import { alertId, notification, signalKey, type Delivery, type DeliveryResult, type MobileRegistration, type PushRecord, type SessionSignal } from "./push";
import { sessionLifecycleRoutes } from "../sessions";
import { pushRoutes } from "./routes";
import { deliverRecord } from "./worker";

const working: SessionSignal = { id: "s1", title: "Private repository task", activity: "working", activityAt: 1000, projectId: "p1" };
const blocked: SessionSignal = { ...working, activity: "blocked", activityAt: 2000 };
const finished: SessionSignal = { ...working, activity: "idle", activityAt: 3000, lastTurnEndedAt: 3000 };
const failed: SessionSignal = { ...finished, lastTurnFailed: true };

function pass(state: DesktopState, sessions: SessionSignal[], changed?: Set<string>) {
  return desktopNotices(state, sessions, changed);
}

describe("which transitions reach the Mac", () => {
  test("the first pass baselines: a launch never replays history", () => {
    const { notices, state } = pass(emptyDesktopState(), [blocked, failed]);
    expect(notices).toEqual([]);
    expect(state.baselined).toBe(true);
  });

  test("blocked, finished and failed each fire once per transition", () => {
    let { state } = pass(emptyDesktopState(), [working]);
    const toBlocked = pass(state, [blocked]);
    expect(toBlocked.notices.map((n) => n.kind)).toEqual(["blocked"]);
    expect(pass(toBlocked.state, [blocked]).notices).toEqual([]);
    ({ state } = pass(toBlocked.state, [working]));
    expect(pass(state, [finished]).notices.map((n) => n.kind)).toEqual(["finished"]);
    expect(pass(state, [failed]).notices.map((n) => n.kind)).toEqual(["failed"]);
  });

  test("a session created after the baseline alerts on first sight", () => {
    const { state } = pass(emptyDesktopState(), []);
    expect(pass(state, [blocked]).notices).toHaveLength(1);
  });

  test("an unchanged session outside the change set is skipped, as a phone record skips it", () => {
    const { state } = pass(emptyDesktopState(), [working]);
    const moved = { ...blocked, id: "s2" };
    const next = pass({ ...state, seen: { ...state.seen, s2: "stale" } }, [blocked, moved], new Set(["s2"]));
    expect(next.notices.map((n) => n.sessionId)).toEqual(["s2"]);
  });

  test("a phone that turned completions off does not change what the Mac shows", () => {
    const phone: MobileRegistration = { hostId: "h", token: "t", topic: "io.github.novarix.telar", sandbox: false, enabled: true, completions: false, previews: true, mutedSessions: [] };
    const { state } = pass(emptyDesktopState(), [working]);
    expect(notification(phone, finished, state.seen.s1)).toBeUndefined();
    expect(pass(state, [finished]).notices.map((n) => n.kind)).toEqual(["finished"]);
  });

  test("the banner carries the session's title and opens the session", () => {
    const { state } = pass(emptyDesktopState(), [working]);
    const [shown] = pass(state, [blocked]).notices;
    expect(shown).toMatchObject({ type: DESKTOP_NOTICE, title: "Private repository task", path: "/projects/p1/sessions/s1" });
    expect(shown).not.toHaveProperty("sound");
  });

  test("a session with no project opens at /main", () => {
    const { state } = pass(emptyDesktopState(), [{ ...working, projectId: undefined }]);
    expect(pass(state, [{ ...blocked, projectId: undefined }]).notices[0].path).toBe("/main");
  });

  test("Approve is offered only for a single approvable request, and the offer retires when the session moves", () => {
    const { state } = pass(emptyDesktopState(), [working]);
    expect(pass(state, [blocked]).notices[0].request).toBeUndefined();
    const offered = pass(state, [{ ...blocked, approvable: "r1" }]);
    expect(offered.notices[0].request).toBe("r1");
    expect(offered.state.offered).toEqual({ s1: "r1" });
    expect(pass(offered.state, [working]).state.offered).toEqual({});
    expect(pass(offered.state, []).state.offered).toEqual({});
  });
});

describe("the desktop stream", () => {
  const channel = () => {
    const sent: unknown[] = [];
    return { sent, connected: true, send: (message: unknown) => { sent.push(message); } };
  };

  test("is attached only while a shell is subscribed, and every subscriber gets each message as an event", () => {
    const stream = createDesktopStream();
    expect(desktopAttached(stream)).toBe(false);
    const first: string[] = [], second: string[] = [];
    const stopFirst = stream.subscribe({ write: (chunk) => first.push(chunk) });
    const stopSecond = stream.subscribe({ write: (chunk) => second.push(chunk) });
    expect(desktopAttached(stream)).toBe(true);
    stream.send({ type: DESKTOP_DISMISS, sessionId: "s1" });
    stopFirst();
    stream.send({ type: DESKTOP_DISMISS, sessionId: "s2" });
    stopSecond();
    expect(desktopAttached(stream)).toBe(false);
    expect(first).toEqual([`data: ${JSON.stringify({ type: DESKTOP_DISMISS, sessionId: "s1" })}\n\n`]);
    expect(second).toHaveLength(2);
    expect(desktopAttached({ ...channel(), connected: false })).toBe(false);
  });

  test("Approve resolves exactly the offered request, with accept, once", async () => {
    const state: DesktopState = { seen: {}, baselined: true, offered: { s1: "r1" } };
    const resolved: unknown[] = [];
    const resolve = async (...args: unknown[]) => { resolved.push(args); };
    const wire = channel();
    await handleDesktopMessage({ type: DESKTOP_APPROVE, sessionId: "s1", requestId: "r1" }, resolve, wire, state);
    expect(resolved).toEqual([["s1", "r1", { decision: "accept" }]]);
    expect(wire.sent).toEqual([{ type: DESKTOP_APPROVED, sessionId: "s1", requestId: "r1", ok: true }]);
    await handleDesktopMessage({ type: DESKTOP_APPROVE, sessionId: "s1", requestId: "r1" }, resolve, wire, state);
    await handleDesktopMessage({ type: DESKTOP_APPROVE, sessionId: "s1", requestId: "r2" }, resolve, wire, { ...state, offered: { s1: "r1" } });
    expect(resolved).toHaveLength(1);
    expect(wire.sent.slice(1)).toEqual([
      { type: DESKTOP_APPROVED, sessionId: "s1", requestId: "r1", ok: false },
      { type: DESKTOP_APPROVED, sessionId: "s1", requestId: "r2", ok: false },
    ]);
  });

  test("a failed resolve answers not ok, and malformed messages are ignored", async () => {
    const wire = channel();
    await handleDesktopMessage({ type: DESKTOP_APPROVE, sessionId: "s1", requestId: "r1" }, async () => { throw new Error("409"); }, wire, { seen: {}, baselined: true, offered: { s1: "r1" } });
    expect(wire.sent).toEqual([{ type: DESKTOP_APPROVED, sessionId: "s1", requestId: "r1", ok: false }]);
    for (const junk of [null, "approve", { type: "other" }, { type: DESKTOP_APPROVE, sessionId: 1, requestId: "r1" }, { type: DESKTOP_APPROVE, sessionId: "s1", requestId: "" }]) {
      await handleDesktopMessage(junk, async () => { throw new Error("must not run"); }, wire, { seen: {}, baselined: true, offered: { s1: "r1" } });
    }
    expect(wire.sent).toHaveLength(1);
  });

  test("the shell's approve, posted to the engine, resolves through the engine client", async () => {
    const resolved: unknown[] = [];
    const client = { resolveRequest: async (...args: unknown[]) => { resolved.push(args); } } as unknown as EngineClient;
    const { route, params } = matchRoute(pushRoutes({ client: () => client, pairedDevices: () => [] }), "POST", "/v2/push/desktop/messages")!;
    const g = globalThis as { telarDesktopNotify?: DesktopState };
    const before = g.telarDesktopNotify;
    g.telarDesktopNotify = { seen: {}, baselined: true, offered: { s1: "r1" } };
    try {
      expect(await route.handle({ body: { type: DESKTOP_APPROVE, sessionId: "s1", requestId: "r1" }, params, query: new URLSearchParams(), request: {} as http.IncomingMessage, response: {} as http.ServerResponse })).toEqual({ status: 200, body: { ok: true } });
      expect(resolved).toEqual([["s1", "r1", { decision: "accept" }]]);
    } finally { g.telarDesktopNotify = before; }
  });
});

const g = globalThis as { telarDesktopNotify?: DesktopState };
const recorder = () => ({ sent: [] as unknown[], connected: true, send(message: unknown) { this.sent.push(message); } });

describe("one alert reaches every device, under one id, and a read anywhere clears it everywhere", () => {
  const ended: SessionSignal = { ...working, activity: "idle", activityAt: 3000, lastTurnEndedAt: 3000, lastTurnSequence: 2, lastReadTurnSequence: 1 };
  const before: SessionSignal = { ...working, lastTurnSequence: 1, lastReadTurnSequence: 1 };
  const phone: PushRecord = {
    hostId: "12345678-1234-1234-1234-123456789abc", token: "a".repeat(64), topic: "io.github.novarix.telar", sandbox: false,
    enabled: true, completions: true, previews: false, mutedSessions: [],
    deviceId: "paired", revision: "r1", updatedAt: 1000, baselined: true, seen: { s1: signalKey(before) }, activitySent: {},
  };
  const moved = new Set(["s1"]);
  const phoneSends = () => {
    const sent: Delivery[] = [];
    return { sent, send: async (delivery: Delivery): Promise<DeliveryResult> => { sent.push(delivery); return { status: 200 }; } };
  };

  test("the Mac banner and the phone push carry the same id", async () => {
    g.telarDesktopNotify = { seen: { s1: signalKey(before) }, baselined: true, offered: {} };
    const mac = recorder();
    notifyDesktop([ended], moved, mac);
    const push = phoneSends();
    await deliverRecord(phone, [ended], push.send, 11, { changed: moved, readSync: true });
    expect(mac.sent).toEqual([expect.objectContaining({ type: DESKTOP_NOTICE, kind: "finished", sessionId: "s1", id: alertId("s1") })]);
    expect(push.sent.map((d) => [d.kind, d.collapseId])).toEqual([["alert", alertId("s1")]]);
  });

  test("read on the Mac or the phone: the read receipt takes the Mac banner down and the phone is told to clear it", async () => {
    const dismissed: string[] = [];
    const store = { records: { markRead: (id: string) => ({ id }) } } as unknown as Parameters<typeof sessionLifecycleRoutes>[0];
    const { route, params } = matchRoute(sessionLifecycleRoutes(store, (id) => dismissed.push(id)), "POST", "/v2/sessions/s1/read")!;
    await route.handle({ body: { runId: "run_2" }, params, query: new URLSearchParams(), request: {} as http.IncomingMessage, response: {} as http.ServerResponse });
    expect(dismissed).toEqual(["s1"]);

    const mac = recorder();
    dismissDesktop("s1", mac);
    expect(mac.sent).toEqual([{ type: DESKTOP_DISMISS, sessionId: "s1", id: alertId("s1") }]);

    const push = phoneSends();
    const alerted = (await deliverRecord(phone, [ended], push.send, 11, { changed: moved, readSync: true }))!;
    await deliverRecord(alerted, [{ ...ended, lastReadTurnSequence: 2 }], push.send, 11 + 120, { readSync: true });
    expect(push.sent.filter((d) => d.kind === "background").map((d) => d.payload.read)).toEqual([{ host: phone.hostId, sessions: ["s1"] }]);
  });

  test("no device holds another back: the session on the Mac's screen still pushes the phone", async () => {
    g.telarDesktopNotify = { seen: { s1: signalKey(before) }, baselined: true, offered: {} };
    const mac = recorder();
    notifyDesktop([ended], moved, mac);
    const push = phoneSends();
    await deliverRecord(phone, [ended], push.send, 11, { changed: moved });
    expect([mac.sent.length, push.sent.length]).toEqual([1, 1]);
  });
});

describe("read elsewhere takes the Mac's banner down", () => {
  test("a dismiss names the session and its alert id, and goes only to a shell that is there", () => {
    const sent: unknown[] = [];
    const wire = { connected: false, send: (message: unknown) => { sent.push(message); } };
    dismissDesktop("s1", wire);
    expect(sent).toEqual([]);
    wire.connected = true;
    dismissDesktop("x".repeat(300), wire);
    expect(sent).toEqual([]);
    dismissDesktop("s1", wire);
    expect(sent).toEqual([{ type: DESKTOP_DISMISS, sessionId: "s1", id: alertId("s1") }]);
  });
});
