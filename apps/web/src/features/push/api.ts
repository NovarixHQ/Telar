import type { WebhookStatus } from "@telar/engine-client";
import { request } from "@/platform/engine/transport";

export const webhookStatus = () => request<WebhookStatus>(fetch, "GET", "/v2/push/webhook");

export const saveWebhook = (patch: { url?: string; secret?: string | null }) => request<WebhookStatus>(fetch, "PUT", "/v2/push/webhook", patch);

export const testWebhook = () => request<{ status: number }>(fetch, "POST", "/v2/push/webhook/test");
