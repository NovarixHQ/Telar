export type ActivityReport = {
  card: boolean;
  blocker?: "off" | "no-start-token";
  lastStart?: { at: number; status: number; reason?: string; relay?: boolean; token?: string };
};

export type WebhookEventType = "session.finished" | "session.failed" | "session.blocked" | "test";

export type WebhookEvent = {
  id: string;
  event: WebhookEventType;
  sessionId: string;
  title: string;
  project: { id: string; name?: string } | null;
  status: string;
  at: string;
};

export type WebhookStatus = {
  configured: boolean;
  target?: string;
  hasSecret: boolean;
  last?: { at: number; status: number };
};
