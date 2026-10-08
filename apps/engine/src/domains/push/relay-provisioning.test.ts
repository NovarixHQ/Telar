import { afterEach, describe, expect, test } from "bun:test";
import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineClient } from "@telar/engine-client";
import { matchRoute } from "../../platform/http/router";
import type { Route } from "../../platform/http/route";
import { notification, pushAvailable, pushConfigured, readPushRecords, saveRegistration, signalKey, writePushRecords, type MobileRegistration, type PushRecord, type SessionSignal } from "./push";
import { pushRoutes } from "./routes";
import { deliverRecord, startMobilePushWorker, stopMobilePushWorker } from "./worker";

const old = { home: process.env.TELAR_HOME, key: process.env.TELAR_APNS_KEY_ID };
let folder: string | undefined;

afterEach(() => {
  stopMobilePushWorker();
  for (const [name, value] of [["TELAR_HOME", old.home], ["TELAR_APNS_KEY_ID", old.key]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (folder) fs.rmSync(folder, { recursive: true, force: true });
  folder = undefined;
});

function setup() {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "telar-relay-"));
  process.env.TELAR_HOME = folder;
  delete process.env.TELAR_APNS_KEY_ID;
}
const phone = { id: "phone", name: "Facundo's iPhone", role: "full" };
const workerDeps = { client: () => ({}) as EngineClient, fullDevices: () => [phone.id] };
async function call(method: Route["method"], pathname: string, devices = [phone]) {
  const { route, params } = matchRoute(pushRoutes({ client: () => ({}) as EngineClient, pairedDevices: () => devices }), method, pathname)!;
  return route.handle({ body: {}, params, query: new URLSearchParams(), request: {} as http.IncomingMessage, response: {} as http.ServerResponse }) as Promise<{ status: number; body: Record<string, unknown> }>;
}

const registration: MobileRegistration = {
  hostId: "12345678-1234-1234-1234-123456789abc",
  token: "a".repeat(64),
  topic: "io.github.novarix.telar",
  sandbox: false,
  enabled: true,
  completions: true,
  previews: false,
  mutedSessions: [],
 
};
const working: SessionSignal = { id: "session_a", title: "Private repository task", activity: "working", activityAt: 1000 };

describe("a Mac with nobody to send to", () => {
  test("the worker does not start, and nothing schedules a tick", () => {
    setup();
    expect(pushConfigured()).toBe(false);
    startMobilePushWorker(workerDeps);
    expect((globalThis as { telarMobilePushTimer?: unknown }).telarMobilePushTimer).toBeUndefined();
  });

  test("the registration route says so, rather than accepting in silence", async () => {
    setup();
    expect(await call("GET", "/v2/push/devices/phone")).toEqual({ status: 200, body: { configured: false } });
  });

  test("a phone that brought no relay credential is not sent to", () => {
    setup();
    saveRegistration(phone.id, registration);
    expect(pushAvailable()).toBe(false);
    startMobilePushWorker(workerDeps);
    expect((globalThis as { telarMobilePushTimer?: unknown }).telarMobilePushTimer).toBeUndefined();
  });
});

describe("what a person is pushed about", () => {
  test("a session that opened a request, and a turn that failed", () => {
    const blocked: SessionSignal = { ...working, activity: "blocked", activityAt: 2000 };
    const opened = notification(registration, blocked, signalKey(working))!;
    expect(opened.payload.aps.alert).toEqual({ title: "Telar", body: "A session needs your input or approval." });

    const failed: SessionSignal = { ...working, activity: "idle", lastTurnEndedAt: 3000, lastTurnFailed: true };
    const quiet = notification({ ...registration, completions: false }, failed, signalKey(working))!;
    expect(quiet.payload.aps.alert).toEqual({ title: "Telar", body: "A session failed. Open Telar to review it." });
  });

  test("neither is sent when the phone has alerts off or has muted that session", () => {
    const blocked: SessionSignal = { ...working, activity: "blocked", activityAt: 2000 };
    expect(notification({ ...registration, enabled: false }, blocked, signalKey(working))).toBeUndefined();
    expect(notification({ ...registration, mutedSessions: [working.id] }, blocked, signalKey(working))).toBeUndefined();
  });
});

describe("telling a registered phone from a reached one", () => {
  const record = (): PushRecord => ({ ...registration, deviceId: "paired", revision: "r1", updatedAt: 1000, baselined: true, seen: { [working.id]: signalKey(working) }, activitySent: {} });

  test("a delivery is recorded, and a poll that sent nothing does not invent one", async () => {
    const blocked: SessionSignal = { ...working, activity: "blocked", activityAt: 2000 };
    const sent = await deliverRecord(record(), [blocked], async () => ({ status: 200 }), 5_000);
    expect(sent!.lastDeliveryAt).toBe(5_000);

    const quiet = await deliverRecord(sent!, [working], async () => ({ status: 200 }), 9_000);
    expect(quiet!.lastDeliveryAt).toBe(5_000);
  });

  test("a failed send does not count as a delivery", async () => {
    const blocked: SessionSignal = { ...working, activity: "blocked", activityAt: 2000 };
    const attempted = await deliverRecord(record(), [blocked], async () => ({ status: 503 }), 5_000);
    expect(attempted!.lastDeliveryAt).toBeUndefined();
    expect(attempted!.failures).toBe(1);
  });

  test("it survives the re-registration a preference change causes", () => {
    setup();
    writePushRecords([{ ...record(), lastDeliveryAt: 5_000 }]);
    saveRegistration("paired", { ...registration, completions: false });
    expect(readPushRecords()[0]!.lastDeliveryAt).toBe(5_000);
  });
});
