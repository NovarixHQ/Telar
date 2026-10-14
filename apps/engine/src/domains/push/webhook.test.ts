import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import type { EngineClient, WebhookEvent } from "@telar/engine-client";
import { matchRoute } from "../../platform/http/router";
import type { Route } from "../../platform/http/route";
import { setPushHome, type SessionSignal } from "./push";
import { pushRoutes } from "./routes";
import { deliverWebhook, notifyWebhook, readWebhook, webhookEvents, type WebhookConfig, type WebhookState } from "./webhook";
import { stopMobilePushWorker } from "./worker";

const working: SessionSignal = { id: "s1", title: "Fix the login", activity: "working", activityAt: 1000, projectId: "p1", project: "Telar" };
const blocked: SessionSignal = { ...working, activity: "blocked", activityAt: 2000 };
const finished: SessionSignal = { ...working, activity: "idle", activityAt: 3000, lastTurnEndedAt: 3000 };
const failed: SessionSignal = { ...finished, lastTurnFailed: true };
const empty: WebhookState = { seen: {}, baselined: false };
const config: WebhookConfig = { url: "https://hooks.example.com/telar?key=abc", secret: "s3cret-value" };
const noWait = async () => {};

type Call = { url: string; init: RequestInit };
function recorder(statuses: (number | "throw")[]) {
  const calls: Call[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (next === "throw") throw new Error("connection refused");
    return new Response(null, { status: next });
  }) as unknown as typeof fetch;
  return { calls, fetch: fake };
}

let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "telar-webhook-"));
  setPushHome(folder);
});
afterEach(() => {
  stopMobilePushWorker();
  notifyWebhook([], undefined, { config: undefined });
  setPushHome(undefined);
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("which transitions fire the webhook", () => {
  test("the first pass baselines, then each transition fires once", () => {
    let { events, state } = webhookEvents(empty, [blocked], undefined, 0);
    expect(events).toEqual([]);
    ({ state } = webhookEvents(state, [working], undefined, 0));
    const toBlocked = webhookEvents(state, [blocked], undefined, 0);
    expect(toBlocked.events.map((e) => e.event)).toEqual(["session.blocked"]);
    expect(webhookEvents(toBlocked.state, [blocked], undefined, 0).events).toEqual([]);
    ({ state } = webhookEvents(toBlocked.state, [working], undefined, 0));
    expect(webhookEvents(state, [finished], undefined, 0).events.map((e) => e.event)).toEqual(["session.finished"]);
    expect(webhookEvents(state, [failed], undefined, 0).events.map((e) => e.event)).toEqual(["session.failed"]);
  });

  test("an event names the session, its project, its status and when", () => {
    const { state } = webhookEvents(empty, [working], undefined, 0);
    const [event] = webhookEvents(state, [finished], undefined, Date.UTC(2026, 9, 13, 12)).events;
    expect(event).toMatchObject({ event: "session.finished", sessionId: "s1", title: "Fix the login", project: { id: "p1", name: "Telar" }, status: "idle", at: "2026-10-13T12:00:00.000Z" });
  });
});

describe("delivery", () => {
  test("a configured webhook is POSTed the event, with the secret as a bearer and an HMAC of the body", async () => {
    const { calls, fetch } = recorder([200]);
    notifyWebhook([working], undefined, { config, fetch });
    const statuses = await Promise.all(notifyWebhook([blocked], undefined, { config, fetch }));
    expect(statuses).toEqual([200]);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    const event = JSON.parse(String(init.body)) as WebhookEvent;
    expect(url).toBe(config.url);
    expect(event).toMatchObject({ event: "session.blocked", sessionId: "s1" });
    expect(headers.authorization).toBe("Bearer s3cret-value");
    expect(headers["x-telar-signature"]).toBe(`sha256=${crypto.createHmac("sha256", "s3cret-value").update(String(init.body)).digest("hex")}`);
  });

  test("without a URL nothing is sent", async () => {
    const { calls, fetch } = recorder([200]);
    notifyWebhook([working], undefined, { fetch });
    expect(notifyWebhook([blocked], undefined, { fetch })).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("an unreachable receiver is retried with backoff, then given up on without throwing or logging the secret", async () => {
    const { calls, fetch } = recorder(["throw"]);
    const waits: number[] = [];
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    notifyWebhook([working], undefined, { config, fetch });
    const statuses = await Promise.all(notifyWebhook([blocked], undefined, { config, fetch, sleep: async (ms) => void waits.push(ms) }));
    expect(statuses).toEqual([0]);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([1_000, 5_000, 30_000]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("s3cret-value");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("key=abc");
    warn.mockRestore();
  });

  test("a server error is retried until it answers; a refusal is not retried", async () => {
    const flaky = recorder([503, 200]);
    expect(await deliverWebhook(config, { id: "e", event: "test", sessionId: "", title: "", project: null, status: "test", at: "" }, { fetch: flaky.fetch, sleep: noWait })).toBe(200);
    expect(flaky.calls).toHaveLength(2);
    const refused = recorder([401]);
    expect(await deliverWebhook(config, { id: "e", event: "test", sessionId: "", title: "", project: null, status: "test", at: "" }, { fetch: refused.fetch, sleep: noWait })).toBe(401);
    expect(refused.calls).toHaveLength(1);
  });
});

describe("webhook settings routes", () => {
  const call = async (method: Route["method"], pathname: string, body: unknown = {}) => {
    const routes = pushRoutes({ client: () => ({}) as EngineClient, pairedDevices: () => [] });
    const { route, params } = matchRoute(routes, method, pathname)!;
    return (await route.handle({ body: body as Record<string, unknown>, params, query: new URLSearchParams(), request: {} as http.IncomingMessage, response: {} as http.ServerResponse }))!;
  };

  test("a saved webhook shows only its origin, never the secret, and the file is private", async () => {
    const saved = await call("PUT", "/v2/push/webhook", { url: config.url, secret: config.secret });
    expect(saved.body).toEqual({ configured: true, target: "https://hooks.example.com/…", hasSecret: true });
    expect(JSON.stringify((await call("GET", "/v2/push/webhook")).body)).not.toContain("s3cret");
    expect(fs.statSync(path.join(folder, "webhook.json")).mode & 0o777).toBe(0o600);
  });

  test("changing the URL keeps the secret unless it is cleared, and an empty URL turns it off", async () => {
    await call("PUT", "/v2/push/webhook", { url: config.url, secret: config.secret });
    await call("PUT", "/v2/push/webhook", { url: "https://other.example.com/hook" });
    expect(readWebhook()).toEqual({ url: "https://other.example.com/hook", secret: "s3cret-value" });
    await call("PUT", "/v2/push/webhook", { url: "https://other.example.com/hook", secret: null });
    expect(readWebhook()).toEqual({ url: "https://other.example.com/hook" });
    expect((await call("PUT", "/v2/push/webhook", { url: "" })).body).toEqual({ configured: false, hasSecret: false });
  });

  test("a secret can be set alone, keeping the saved URL, but not before there is a URL", async () => {
    expect((await call("PUT", "/v2/push/webhook", { secret: "early" })).status).toBe(409);
    await call("PUT", "/v2/push/webhook", { url: config.url });
    await call("PUT", "/v2/push/webhook", { secret: "later" });
    expect(readWebhook()).toEqual({ url: config.url, secret: "later" });
  });

  test("a URL that is not http or https is refused", async () => {
    expect((await call("PUT", "/v2/push/webhook", { url: "file:///etc/passwd" })).status).toBe(400);
    expect(readWebhook()).toBeUndefined();
  });
});
