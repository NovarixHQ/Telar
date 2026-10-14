import crypto from "node:crypto";
import fs from "node:fs";
import type { WebhookEvent, WebhookStatus } from "@telar/engine-client";
import { atomicWrite } from "../../platform/fs/atomic";
import { alertKind, signalKey, webhookFile, type SessionSignal } from "./push";

export type WebhookConfig = { url: string; secret?: string };
export type WebhookState = { seen: Record<string, string>; baselined: boolean };
export type WebhookDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const TIMEOUT_MS = 5_000;
const BACKOFF_MS = [1_000, 5_000, 30_000];
const MAX_IN_FLIGHT = 32;

const hook = globalThis as typeof globalThis & { telarWebhook?: WebhookState; telarWebhookLast?: WebhookStatus["last"]; telarWebhookInFlight?: number };

export class WebhookInputError extends Error {}

export function parseWebhookUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2048) throw new WebhookInputError("The webhook URL must be an http or https address.");
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new WebhookInputError("The webhook URL must be an http or https address."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new WebhookInputError("The webhook URL must be an http or https address.");
  return url.toString();
}

export function readWebhook(file?: string): WebhookConfig | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file ?? webhookFile(), "utf8")) as Partial<WebhookConfig>;
    if (typeof value.url !== "string") return undefined;
    return { url: value.url, ...(typeof value.secret === "string" && value.secret ? { secret: value.secret } : {}) };
  } catch {
    return undefined;
  }
}

export function writeWebhook(config: WebhookConfig | undefined, file = webhookFile()): void {
  if (config) atomicWrite(file, config);
  else fs.rmSync(file, { force: true });
}

export function webhookStatus(config = readWebhook()): WebhookStatus {
  return {
    configured: config !== undefined,
    ...(config ? { target: `${new URL(config.url).origin}/…` } : {}),
    hasSecret: config?.secret !== undefined,
    ...(hook.telarWebhookLast ? { last: hook.telarWebhookLast } : {}),
  };
}

/** The same transitions, and the same once-per-transition memory, as the desktop banner. */
export function webhookEvents(state: WebhookState, sessions: readonly SessionSignal[], changed: ReadonlySet<string> | undefined, now: number): { events: WebhookEvent[]; state: WebhookState } {
  const next: WebhookState = { seen: { ...state.seen }, baselined: true };
  const events: WebhookEvent[] = [];
  for (const session of sessions) {
    if (changed && !changed.has(session.id) && session.id in state.seen) continue;
    const kind = alertKind(session, state.seen[session.id] ?? (state.baselined ? "new:0:0:false" : undefined), true);
    next.seen[session.id] = signalKey(session);
    if (!kind) continue;
    events.push({
      id: crypto.randomUUID(),
      event: `session.${kind}`,
      sessionId: session.id,
      title: session.title,
      project: session.projectId === undefined ? null : { id: session.projectId, ...(session.project ? { name: session.project } : {}) },
      status: session.activity,
      at: new Date(now).toISOString(),
    });
  }
  const ids = new Set(sessions.map((s) => s.id));
  for (const id of Object.keys(next.seen)) if (!ids.has(id)) delete next.seen[id];
  return { events, state: next };
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
const retryable = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

/** Resolves with the last status (0 when nothing answered); it never throws. */
export async function deliverWebhook(config: WebhookConfig, event: WebhookEvent, deps: WebhookDeps = {}, attempts = BACKOFF_MS.length + 1): Promise<number> {
  const send = deps.fetch ?? fetch;
  const body = JSON.stringify(event);
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Telar-Webhook", "x-telar-event": event.event, "x-telar-delivery": event.id };
  if (config.secret) {
    headers.authorization = `Bearer ${config.secret}`;
    headers["x-telar-signature"] = `sha256=${crypto.createHmac("sha256", config.secret).update(body).digest("hex")}`;
  }
  let status = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await (deps.sleep ?? pause)(BACKOFF_MS[attempt - 1]!);
    try {
      const response = await send(config.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = response.status;
      await response.body?.cancel().catch(() => undefined);
    } catch {
      status = 0;
    }
    if ((status >= 200 && status < 300) || !retryable(status)) break;
  }
  hook.telarWebhookLast = { at: Date.now(), status };
  return status;
}

/** Fire and forget: delivery runs off the caller's path, and a full queue drops the event rather than wait. */
export function notifyWebhook(sessions: readonly SessionSignal[], changed: ReadonlySet<string> | undefined, deps: WebhookDeps & { config?: WebhookConfig } = {}): Promise<number>[] {
  const config = "config" in deps ? deps.config : readWebhook();
  if (!config) {
    delete hook.telarWebhook;
    delete hook.telarWebhookLast;
    return [];
  }
  const { events, state } = webhookEvents(hook.telarWebhook ?? { seen: {}, baselined: false }, sessions, changed, Date.now());
  hook.telarWebhook = state;
  return events.flatMap((event) => {
    if ((hook.telarWebhookInFlight ?? 0) >= MAX_IN_FLIGHT) return [];
    hook.telarWebhookInFlight = (hook.telarWebhookInFlight ?? 0) + 1;
    return [
      deliverWebhook(config, event, deps)
        .then((status) => {
          if (status < 200 || status >= 300) console.warn(`[webhook] ${event.event} for a session was not delivered (status ${status}).`);
          return status;
        })
        .finally(() => {
          hook.telarWebhookInFlight = (hook.telarWebhookInFlight ?? 1) - 1;
        }),
    ];
  });
}
