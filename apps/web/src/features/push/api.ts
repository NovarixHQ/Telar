import type { WebhookStatus } from "@telar/engine-client";
import { request } from "@/platform/engine/transport";

export const webhookStatus = () => request<WebhookStatus>(fetch, "GET", "/api/push/webhook");

export const saveWebhook = (patch: { url?: string; secret?: string | null }) => request<WebhookStatus>(fetch, "PUT", "/api/push/webhook", patch);

export const testWebhook = () => request<{ status: number }>(fetch, "POST", "/api/push/webhook/test");
