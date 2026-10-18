import crypto from "node:crypto";
import { EngineClientError, type EngineClient } from "@telar/engine-client";
import { fail, ok, type Route } from "../../platform/http/route";
import { desktopStream, handleDesktopMessage } from "./desktop";
import { activityReport, parseRegistration, pushConfigured, PushInputError, readPushRecords, saveRegistration, writePushRecords } from "./push";
import { clearedSessions, parseReadStateIds } from "./read-sync";
import { deliverWebhook, parseWebhookUrl, readWebhook, WebhookInputError, webhookStatus, writeWebhook } from "./webhook";
import { sendRelayTest, startMobilePushWorker } from "./worker";

export type PushRouteDeps = {
  client: () => EngineClient;
  pairedDevices: () => { id: string; name: string; scopes: string[] }[];
};

function activityFor(deviceId: string, topic?: string) {
  const record = readPushRecords().find((r) => r.deviceId === deviceId && (topic === undefined || r.topic === topic));
  return record ? { activity: activityReport(record) } : {};
}

export function pushRoutes(deps: PushRouteDeps): Route[] {
  const start = () => startMobilePushWorker({ client: deps.client, fullDevices: () => deps.pairedDevices().filter((d) => d.scopes.includes("write")).map((d) => d.id) });
  return [
    {
      method: "GET",
      path: /^\/v2\/push\/devices\/([^/]+)$/,
      auth: "engine",
      handle: ({ params: [deviceId] }) => ok({ configured: pushConfigured(), ...activityFor(deviceId!) }),
    },
    {
      method: "PUT",
      path: /^\/v2\/push\/devices\/([^/]+)$/,
      auth: "engine",
      handle({ body, params: [deviceId] }) {
        if (body.simulator === true) {
          writePushRecords(readPushRecords().filter((record) => record.deviceId !== deviceId));
          return ok({ configured: false });
        }
        let registration;
        try {
          registration = parseRegistration(body);
        } catch (error) {
          if (error instanceof PushInputError) return fail(400, "invalid_request", "Invalid push registration.");
          throw error;
        }
        saveRegistration(deviceId!, registration);
        start();
        if (registration.relay) void sendRelayTest(deviceId!, registration.topic);
        return ok({ configured: registration.relay !== undefined || pushConfigured(), ...activityFor(deviceId!, registration.topic) });
      },
    },
    {
      method: "GET",
      path: "/v2/push/read-state",
      auth: "engine",
      async handle({ query }) {
        const ids = parseReadStateIds(query.get("ids"));
        if (!ids) return fail(400, "invalid_request", "Name between 1 and 64 session ids.");
        const cleared = await clearedSessions(ids, async (id) => {
          try {
            return (await deps.client().session(id, { turns: 1 })).session;
          } catch (error) {
            if (error instanceof EngineClientError && error.code === "not_found") return undefined;
            throw error;
          }
        });
        return ok({ cleared });
      },
    },
    {
      method: "POST",
      path: "/v2/push/desktop/messages",
      auth: "engine",
      async handle({ body }) {
        await handleDesktopMessage(body, (sessionId, requestId, input) => deps.client().resolveRequest(sessionId, requestId, input));
        return ok({ ok: true });
      },
    },
    ...webhookRoutes(start),
  ];
}

function webhookRoutes(start: () => void): Route[] {
  return [
    { method: "GET", path: "/v2/push/webhook", auth: "engine", handle: () => ok(webhookStatus()) },
    {
      method: "PUT",
      path: "/v2/push/webhook",
      auth: "engine",
      handle({ body }) {
        if (body.url === null || body.url === "") {
          writeWebhook(undefined);
          return ok(webhookStatus());
        }
        if (body.secret !== undefined && body.secret !== null && (typeof body.secret !== "string" || body.secret.length > 512)) return fail(400, "invalid_request", "The secret must be text of at most 512 characters.");
        try {
          const saved = readWebhook();
          if (body.url === undefined && !saved) return fail(409, "conflict", "Set a webhook URL first.");
          const url = body.url === undefined ? saved!.url : parseWebhookUrl(body.url);
          const secret = body.secret === undefined ? saved?.secret : typeof body.secret === "string" ? body.secret.trim() : "";
          writeWebhook({ url, ...(secret ? { secret } : {}) });
        } catch (error) {
          if (error instanceof WebhookInputError) return fail(400, "invalid_request", error.message);
          throw error;
        }
        start();
        return ok(webhookStatus());
      },
    },
    {
      method: "POST",
      path: "/v2/push/webhook/test",
      auth: "engine",
      async handle() {
        const config = readWebhook();
        if (!config) return fail(409, "conflict", "No webhook URL is set.");
        const status = await deliverWebhook(config, { id: crypto.randomUUID(), event: "test", sessionId: "", title: "Test from Telar", project: null, status: "test", at: new Date().toISOString() }, {}, 1);
        return ok({ status });
      },
    },
  ];
}

const BEAT_MS = 25_000;

export function serveDesktopStream(
  response: { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): unknown },
  deps: PushRouteDeps,
): () => void {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  response.write(": open\n\n");
  const unsubscribe = desktopStream.subscribe(response);
  const beat = setInterval(() => response.write(": beat\n\n"), BEAT_MS);
  beat.unref();
  startMobilePushWorker({ client: deps.client, fullDevices: () => deps.pairedDevices().filter((d) => d.scopes.includes("write")).map((d) => d.id) });
  return () => {
    clearInterval(beat);
    unsubscribe();
  };
}
