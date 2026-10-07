import { z } from "zod";
import type { EngineRequest } from "@telar/engine-client";
import { err, failure, fillWithin, json, type ToolFactory } from "../../agent-tools";
import { NO_SELF, REQUESTS, REQUESTS_CHARS, REQUESTS_LIMIT, type SessionsCapability, SUBSCRIBE, SUBSCRIPTIONS_CHARS, SUBSCRIPTIONS_LIMIT } from "./shared";

export function wakeTools(tool: ToolFactory, capability: SessionsCapability): unknown[] {
  return [...subscriptionTools(tool, capability), ...requestTools(tool, capability)];
}

function subscriptionTools(tool: ToolFactory, capability: SessionsCapability): unknown[] {
  return [
    tool(
      "sessions_subscribe",
      SUBSCRIBE,
      {
        sessionId: z.string().min(1).optional().describe("Wake me once when its turn ends."),
        cancel: z.string().min(1).optional().describe("An id to stop."),
      },
      async (args) => {
        if (!capability.self) return err(NO_SELF);
        const self = capability.self.sessionId;
        if (args.sessionId !== undefined && args.cancel !== undefined) return err("Pass sessionId to subscribe OR cancel to stop one, not both in one call.");
        if (typeof args.sessionId === "string") return subscribe(capability, self, args.sessionId);
        if (typeof args.cancel === "string") return cancel(capability, self, args.cancel);
        return listSubscriptions(capability, self);
      },
    ),
  ];
}

async function subscribe(capability: SessionsCapability, self: string, targetSessionId: string) {
  try {
    const subscription = await capability.subscribe(self, { targetSessionId, once: true });
    return json({ ...subscription, note: `You will be woken once, when ${targetSessionId} ends a turn. End your turn now.` });
  } catch (error) {
    return err(`Could not subscribe: ${failure(error)}`);
  }
}

async function cancel(capability: SessionsCapability, self: string, subscriptionId: string) {
  try {
    const removed = await capability.unsubscribe(subscriptionId, self);
    return json({ subscriptionId, removed, ...(removed ? {} : { note: "No subscription of yours has that id — it was already removed, or it was never yours." }) });
  } catch (error) {
    return err(`Could not unsubscribe "${subscriptionId}": ${failure(error)}`);
  }
}

async function listSubscriptions(capability: SessionsCapability, self: string) {
  try {
    const subscriptions = await capability.subscriptions(self);
    const { rows } = fillWithin(subscriptions, (subscription) => subscription, {
      limit: SUBSCRIPTIONS_LIMIT,
      chars: SUBSCRIPTIONS_CHARS,
    });
    return json({
      subscriptions: rows,
      ...(subscriptions.length > rows.length ? { total: subscriptions.length, notShown: subscriptions.length - rows.length } : {}),
      ...(subscriptions.length === 0
        ? { note: "This session is not subscribed to anything." }
        : subscriptions.length > rows.length
          ? { note: `${rows.length} of ${subscriptions.length}. That many at once is usually a sign that one-shot subscriptions were not being removed.` }
          : {}),
    });
  } catch (error) {
    return err(`Could not list subscriptions: ${failure(error)}`);
  }
}

function requestTools(tool: ToolFactory, capability: SessionsCapability): unknown[] {
  return [
    tool(
      "sessions_requests",
      REQUESTS,
      {
        sessionId: z.string().min(1),
        requestId: z.string().min(1).optional().describe("Answer this one; omit to list them."),
        decision: z
          .enum(["accept", "acceptForSession", "decline"])
          .optional()
          .describe("With requestId. acceptForSession also accepts later ones of that kind."),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Keyed as the list named its fields."),
        reason: z.string().optional().describe("One sentence."),
      },
      async (args) => {
        const sessionId = String(args.sessionId ?? "");
        if (typeof args.requestId === "string") return resolveRequest(capability, sessionId, args.requestId, args);
        if (args.decision !== undefined || args.answers !== undefined || args.reason !== undefined) {
          return err("decision, answers and reason answer one request: pass its requestId too.");
        }
        return listRequests(capability, sessionId);
      },
    ),
  ];
}

async function listRequests(capability: SessionsCapability, sessionId: string) {
  let requests: EngineRequest[];
  try {
    requests = (await capability.requests(sessionId)).filter((request) => request.state === "open");
  } catch (error) {
    return err(`Could not read requests of "${sessionId}": ${failure(error)}`);
  }
  const { rows } = fillWithin(requests, describeRequest, { limit: REQUESTS_LIMIT, chars: REQUESTS_CHARS });
  return json({
    sessionId,
    requests: rows,
    ...(requests.length > rows.length ? { total: requests.length, notShown: requests.length - rows.length } : {}),
    ...(requests.length === 0
      ? { note: "This session is not waiting on anything." }
      : requests.length > rows.length
        ? { note: `The first ${rows.length} of ${requests.length} open requests. Answering these makes room for the rest.` }
        : {}),
  });
}

async function resolveRequest(capability: SessionsCapability, sessionId: string, requestId: string, args: Record<string, unknown>) {
  if (args.decision === undefined) return err(`To answer "${requestId}", pass a decision: accept, acceptForSession or decline.`);
  const decision = args.decision === "acceptForSession" ? "acceptForSession" : args.decision === "decline" ? "decline" : "accept";
  try {
    const open = (await capability.requests(sessionId)).find((request) => request.id === requestId);
    if (open && open.detail.kind === "secret_access") {
      return err(`Request "${requestId}" is a secret-access request. Choosing a vault item is the user's alone; leave it for them.`);
    }
  } catch (error) {
    return err(`Could not read requests of "${sessionId}": ${failure(error)}`);
  }
  const answers =
    args.answers && typeof args.answers === "object"
      ? Object.fromEntries(Object.entries(args.answers as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : undefined;
  try {
    const request = await capability.resolveRequest(sessionId, requestId, {
      decision,
      ...(typeof args.reason === "string" && args.reason.trim() ? { reason: args.reason } : {}),
      ...(answers ? { answers } : {}),
    });
    return json({
      ...describeRequest(request),
      decision: request.decision,
      resolvedBy: request.resolvedBy,
      note: "Recorded as answered by a session. The session that asked continues with this answer.",
    });
  } catch (error) {
    return err(`Could not resolve request "${requestId}" on "${sessionId}": ${failure(error)}`);
  }
}

function describeRequest(request: EngineRequest): Record<string, unknown> {
  const base = { id: request.id, runId: request.runId, kind: request.detail.kind, state: request.state, openedAt: request.openedAt };
  const detail = request.detail;
  switch (detail.kind) {
    case "user_input":
      return {
        ...base,
        prompt: detail.prompt,
        fields: detail.fields.map((field) => ({
          key: field.key,
          label: field.label,
          kind: field.kind,
          ...(field.choices && field.choices.length > 0 ? { choices: field.choices } : {}),
          ...(field.required ? { required: true } : {}),
        })),
      };
    case "command_execution":
      return { ...base, command: detail.command.command };
    case "file_change":
      return { ...base, change: `${detail.change.kind} ${detail.change.path}` };
    case "file_read":
      return { ...base, path: detail.read.path };
    case "tool_call":
      return { ...base, tool: detail.call.name };
    case "secret_access":
      return { ...base, origin: detail.secret.origin, note: "A vault pick — the user's alone; answering it here is refused." };
  }
}
