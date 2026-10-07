import { expect, test } from "bun:test";
import { CARD_LINGER_S, ACTIVITY_REFRESH_S, parseRegistration, tokenFingerprint, type Delivery, type DeliveryResult, type PushRecord, type SessionSignal } from "./push";
import type { CardPost } from "./card";
import { automaticActivityDelivery } from "./card";
import { relayV2Delivery } from "./relay-v2";
import { deliverRecord, heartbeatWanted } from "./worker";

const relay = { handle: "h".repeat(43), keyId: "k".repeat(22), sendKey: "s".repeat(43) };
const record = (patch: Partial<PushRecord> = {}): PushRecord => ({
  hostId: "12345678-1234-1234-1234-123456789abc", hostName: "Studio.local", token: "a".repeat(64), topic: "io.github.novarix.telar", sandbox: false,
  enabled: true, completions: false, previews: true, liveActivities: true, relay, relayCard: true, mutedSessions: [],
  deviceId: "phone", revision: "r1", updatedAt: 0, baselined: true, seen: {}, activitySent: {}, ...patch,
});
const work: SessionSignal = { id: "one", title: "Fix the build", activity: "working", activityAt: 1 };

function relayRecorder(answer: DeliveryResult = { status: 200 }) {
  const sent: Delivery[] = [], posts: CardPost[] = [];
  return { sent, posts, send: async (d: Delivery) => { sent.push(d); return { status: 200 }; }, post: async (c: CardPost) => { posts.push(c); return answer; } };
}

test("work is posted as this Mac's rows, never started from here, and posted again only on change or every two minutes", async () => {
  const { sent, posts, send, post } = relayRecorder();
  let r = (await deliverRecord(record(), [work], send, 1000, { post }))!;
  expect(sent).toHaveLength(0);
  expect(posts).toEqual([{ kind: "card", host: { id: r.hostId, name: "Studio" }, active: 1, rows: [{ id: "one", status: "Working", title: "Fix the build" }] }]);
  r = (await deliverRecord(r, [work], send, 1010, { post }))!;
  expect(posts).toHaveLength(1);
  r = (await deliverRecord(r, [work], send, 1000 + ACTIVITY_REFRESH_S, { post }))!;
  expect(posts).toHaveLength(2);
  expect(heartbeatWanted([r], [work])).toBe(true);
});

test("finished work stays on the card while it lingers, then this Mac's rows are cleared once", async () => {
  const { posts, send, post } = relayRecorder();
  let r = (await deliverRecord(record(), [work], send, 1000, { post }))!;
  const done = { ...work, activity: "idle", lastTurnEndedAt: 1_100_000 };
  r = (await deliverRecord(r, [done], send, 1100, { post }))!;
  expect(posts[1]).toMatchObject({ active: 0, rows: [{ id: "one", status: "Done" }] });
  expect(heartbeatWanted([r], [done])).toBe(true);
  r = (await deliverRecord(r, [done], send, 1100 + CARD_LINGER_S, { post }))!;
  expect(posts[2]).toMatchObject({ active: 0, rows: [] });
  r = (await deliverRecord(r, [done], send, 1100 + CARD_LINGER_S + ACTIVITY_REFRESH_S, { post }))!;
  expect(posts).toHaveLength(3);
  expect(heartbeatWanted([r], [done])).toBe(false);
});

test("a Mac with nothing to show posts nothing, and switching Live Activities off clears its rows", async () => {
  const { posts, send, post } = relayRecorder();
  let r = (await deliverRecord(record(), [], send, 1000, { post }))!;
  expect(posts).toHaveLength(0);
  r = (await deliverRecord(r, [work], send, 1010, { post }))!;
  await deliverRecord({ ...r, liveActivities: false }, [work], send, 1020, { post });
  expect(posts.map(p => p.rows.length)).toEqual([1, 0]);
});

test("a session needing you rides on the card when the relay says so, and is sent as an alert when it does not", async () => {
  const blocked = { ...work, activity: "blocked", activityAt: 2 };
  const seen = { one: "working:1:0:false" };
  const on = relayRecorder({ status: 200, alerted: true });
  await deliverRecord(record({ seen }), [blocked], on.send, 1000, { post: on.post });
  expect(on.posts[0]!.alert).toMatchObject({ title: "Fix the build" });
  expect(on.sent).toHaveLength(0);
  const off = relayRecorder({ status: 200 });
  await deliverRecord(record({ seen }), [blocked], off.send, 1000, { post: off.post });
  expect(off.sent.map(d => d.kind)).toEqual(["alert"]);
});

test("a relay that can't take the post backs off nothing", async () => {
  const { posts, send, post } = relayRecorder({ status: 400, relay: true });
  const r = (await deliverRecord(record(), [work], send, 1000, { post }))!;
  expect(posts).toHaveLength(1);
  expect([r.failures, r.retryAt, r.posted]).toEqual([0, undefined, undefined]);
});

test("the relay card is asked for only with a relay", () => {
  const base = { hostId: "12345678-1234-1234-1234-123456789abc", token: "a".repeat(64), topic: "io.github.novarix.telar", sandbox: false, enabled: true, completions: false, previews: false, mutedSessions: [], relayCard: true };
  expect(parseRegistration({ ...base, relay }).relayCard).toBe(true);
  expect(parseRegistration(base).relayCard).toBeUndefined();
  expect(() => parseRegistration({ ...base, relay, relayCard: "yes" })).toThrow();
});

test("the relay gets the card post as it is, and an older app's card update names its token by fingerprint", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json({ status: 200, alerted: true }); }) as unknown as typeof fetch;
  const card: CardPost = { kind: "card", host: { id: record().hostId, name: "Studio" }, active: 1, rows: [{ id: "one", status: "Working" }] };
  expect(await relayV2Delivery(relay, card, fetchImpl)).toEqual({ status: 200, alerted: true });
  await relayV2Delivery(relay, automaticActivityDelivery(record({ relayCard: undefined }), [work], "d".repeat(64), 1, 100), fetchImpl);
  expect(bodies[0]).toEqual(card);
  expect(bodies[1]).toMatchObject({ kind: "liveactivity", activity: "__automatic__", fingerprint: tokenFingerprint("d".repeat(64)) });
  expect(JSON.stringify(bodies[1])).not.toContain("d".repeat(64));
});
