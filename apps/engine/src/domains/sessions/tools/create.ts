import crypto from "node:crypto";
import { z } from "zod";
import type { Session } from "@telar/engine-client";
import { err, failure, json, type ToolFactory } from "../../agent-tools";
import { CREATE, EFFORT, MODEL, type SessionsCapability, summariseOne } from "./shared";

export const modelChoice = (args: Record<string, unknown>): { model?: { model?: string; effort?: string } } => {
  const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
  const effort = typeof args.effort === "string" && args.effort.trim() ? args.effort.trim() : undefined;
  return model || effort ? { model: { ...(model ? { model } : {}), ...(effort ? { effort } : {}) } } : {};
};

const runsOn = (session: Session): Record<string, string> =>
  session.model?.model ? { model: `${session.model.model}${session.model.effort ? ` at ${session.model.effort}` : ""}` } : {};

export const runIdFor = (tool: string, toolCallId: string | undefined): string =>
  toolCallId
    ? `run_${crypto.createHash("sha256").update(`${tool}:${toolCallId}`).digest("hex").slice(0, 32)}`
    : `run_${crypto.randomUUID().replaceAll("-", "")}`;

export function createTool(tool: ToolFactory, capability: SessionsCapability): unknown {
  return tool(
    "sessions_create",
    CREATE,
    {
      projectId: z.string().min(1).describe("From sessions_list."),
      title: z
        .string()
        .optional()
        .describe("A few words; always set one."),
      envMode: z
        .enum(["local", "worktree"])
        .optional()
        .describe("Omit for the project's mode. worktree: its own checkout, to isolate code changes. local: shares the project's checkout."),
      driver: z
        .enum(["claude", "codex"])
        .optional()
        .describe("Omit unless the user asked."),
      model: z.string().min(1).optional().describe(MODEL),
      effort: z.string().min(1).optional().describe(EFFORT),
      task: z.string().min(1).optional().describe("A self-contained brief; it cannot see this conversation."),
      owner: z
        .literal("person")
        .optional()
        .describe("person: the session is the person's own, top level, not filed under you; task is their opening message and you are not subscribed."),
    },
    async (args, context) => createOne(capability, args, context?.toolCallId),
  );
}

async function createOne(capability: SessionsCapability, args: Record<string, unknown>, toolCallId: string | undefined) {
  const shared: { projectId: string; envMode?: "local" | "worktree"; driver?: "claude" | "codex" } = {
    projectId: String(args.projectId ?? ""),
    ...(args.envMode === "local" || args.envMode === "worktree" ? { envMode: args.envMode } : {}),
    ...(args.driver === "claude" || args.driver === "codex" ? { driver: args.driver } : {}),
  };
  const person = args.owner === "person";
  const briefRunId = runIdFor("sessions_create", toolCallId);
  let session: Session;
  try {
    session = await capability.create({
      ...shared,
      ...(typeof args.title === "string" && args.title.trim() ? { title: args.title } : {}),
      ...modelChoice(args),
      ...(person ? { owner: "person" as const, ...(typeof args.task === "string" && args.task ? { brief: { runId: briefRunId, input: args.task } } : {}) } : {}),
    });
  } catch (error) {
    return err(`Could not create a session on "${shared.projectId}": ${failure(error)}`);
  }
  if (person) {
    const note = "Created as the person's own top-level session: it is not filed under you, you are not subscribed, and it will not report back. Do not send it work.";
    const briefed = typeof args.task === "string" && args.task;
    return json({
      ...summariseOne(session, new Map<string, string>()),
      ...runsOn(session),
      ...(briefed ? { runId: briefRunId } : {}),
      note: briefed ? `${note} Your text is queued in it as the person's opening message; end your turn.` : note,
    });
  }
  const where = session.workspace.mode === "worktree"
    ? `Created with a checkout of its own on branch ${session.workspace.branch}.`
    : "Created against the project's own checkout, which it shares with anything else working there.";
  const answer = {
    ...summariseOne(session, new Map<string, string>()),
    ...runsOn(session),
    note: `${where} Nothing is queued and nothing has started — send it a message with intent: task to give it work.`,
    note2: "It is filed under you, but it reports back only when you task it.",
    access: `${session.runtimeMode} — never wider than your own, so if you have to ask about something, so does it.`,
  };
  if (typeof args.task !== "string" || !args.task) return json(answer);
  try {
    const { turn } = await capability.send(session.id, { runId: runIdFor("sessions_create", toolCallId), input: args.task, intent: "task" });
    return json({
      ...answer,
      runId: turn.runId,
      taskState: turn.state,
      ...(turn.agentNotice ? { recipientSees: turn.agentNotice } : {}),
      note: `${where} Your task is queued as ${turn.runId}. When every task is out, end your turn: one line reaches you as each builder finishes. Paste its link when you mention it to the person.`,
    });
  } catch (error) {
    return err(`Created ${session.id}, but the task was not delivered: ${failure(error)}. Send it with sessions_send intent task.`);
  }
}
