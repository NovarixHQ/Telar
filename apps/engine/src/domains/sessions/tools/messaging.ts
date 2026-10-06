import { z } from "zod";
import { err, failure, fillWithin, json, type ToolFactory } from "../../agent-tools";
import { createTool, modelChoice, runIdFor } from "./create";
import { delegationAnswer, WAIT, waitForDelegation, waitRefusal } from "./wait";
import { FIND_LIMIT_DEFAULT, findView } from "./query";
import type { Turn } from "@telar/engine-client";
import { EFFORT, LIST, LIST_CHARS, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, MODEL, SEND, type SessionsCapability, summarise } from "./shared";

export function messagingTools(tool: ToolFactory, capability: SessionsCapability): unknown[] {
  return [
    tool(
      "sessions_list",
      LIST,
      {
        q: z.string().min(1).optional().describe("Search text instead of listing; lexical, not semantic."),
        settled: z
          .boolean()
          .optional()
          .describe("Shelved sessions instead. With q, omit for both."),
        projectId: z.string().optional(),
        since: z.number().int().min(0).optional().describe("With q: epoch ms."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_LIMIT_MAX)
          .optional()
          .describe(`Default ${LIST_LIMIT_DEFAULT}; with q ${FIND_LIMIT_DEFAULT}.`),
        after: z.number().int().min(0).optional().describe("The `next` of a previous page."),
      },
      async (args) => {
        if (typeof args.q === "string" && args.q.trim()) {
          if (args.after !== undefined) return err("after pages a list; a search is narrowed with projectId, settled or since instead.");
          return findView(capability.query, args);
        }
        if (args.since !== undefined) return err("since narrows a search: pass q with it.");
        const settled = args.settled === true;
        const wantedProject = typeof args.projectId === "string" && args.projectId.trim() ? args.projectId.trim() : undefined;
        const limit =
          typeof args.limit === "number" && Number.isSafeInteger(args.limit) && args.limit >= 1
            ? Math.min(args.limit, LIST_LIMIT_MAX)
            : LIST_LIMIT_DEFAULT;
        const after = typeof args.after === "number" && Number.isSafeInteger(args.after) && args.after >= 0 ? args.after : 0;
        const answer = await capability.list({ settled });
        const { sessions, projects } = answer;
        const names = new Map(projects.map((project) => [project.id, project.name]));
        const matching = wantedProject ? sessions.filter((session) => session.projectId === wantedProject) : sessions;
        const window = matching.slice(after, after + limit);
        const drivers = new Set(window.map((session) => session.driver));
        const perRowDriver = drivers.size > 1;
        const { rows } = fillWithin(window, (session) => summarise(session, names, { driver: perRowDriver }), {
          limit,
          chars: LIST_CHARS,
        });
        const page = window.slice(0, rows.length);
        const more = after + page.length < matching.length;
        return json({
          sessions: rows,
          ...(drivers.size === 1 ? { driver: [...drivers][0] } : {}),
          total: matching.length,
          ...(after > 0 ? { after } : {}),
          more,
          ...(more ? { next: after + page.length } : {}),
          ...(!settled && typeof answer.settledCount === "number" && answer.settledCount > 0 ? { settledNotShown: answer.settledCount } : {}),
          projects: projects.map((project) => ({ id: project.id, name: project.name })),
          ...(matching.length === 0
            ? {
                note: wantedProject
                  ? `No ${settled ? "" : "unsettled "}sessions on project "${wantedProject}".`
                  : settled
                    ? "No sessions are live on this engine."
                    : "No unsettled sessions. Settled ones are still live and resumable — ask with settled: true.",
              }
            : more
              ? { note: `Rows ${after}–${after + page.length} of ${matching.length}. Continue with sessions_list(after: ${after + page.length}).` }
              : {}),
          ...(projects.length === 0
            ? { note2: "No projects are registered, so nothing can be created — the user registers a project themselves." }
            : {}),
        });
      },
    ),
    createTool(tool, capability),
    tool(
      "sessions_send",
      SEND,
      {
        sessionId: z.string().min(1),
        intent: z
          .enum(["task", "report", "result", "blocker"])
          .optional()
          .describe("task (assigns work or changes what a running session does; the default to a session you tasked), report (passive, read only with its next turn; the default otherwise), result (your final answer, sent last), blocker (needs a decision)."),
        input: z.string().min(1).describe("The whole message; it cannot see this conversation."),
        corrects: z.string().min(1).optional().describe("runId of your earlier message this corrects; replaced if still unread."),
        model: z.string().min(1).optional().describe(`With intent task, this turn only. ${MODEL}`),
        effort: z.string().min(1).optional().describe(EFFORT),
        wait: WAIT,
      },
      async (args, context) => {
        const sessionId = String(args.sessionId ?? "");
        const text = String(args.input ?? "");
        const corrects = typeof args.corrects === "string" && args.corrects.length > 0 ? args.corrects : undefined;
        const runId = runIdFor("sessions_send", context?.toolCallId);
        const wait = typeof args.wait === "number" ? args.wait : undefined;
        const chosen = modelChoice(args);
        const intent = args.intent === "task" || args.intent === "report" || args.intent === "result" || args.intent === "blocker" ? args.intent : undefined;
        if (wait !== undefined && intent !== "task") return err("wait applies only to intent: task — the one that asks for a result.");
        if (chosen.model && intent !== "task") return err("model and effort apply only to intent: task — the message that runs something.");
        try {
          const refused = wait !== undefined ? await waitRefusal(capability, sessionId) : undefined;
          if (refused) return err(`Not sent: ${refused}`);
          const { turn } = await capability.send(sessionId, { runId, input: text, ...(intent ? { intent } : {}), ...(corrects ? { corrects } : {}), ...chosen });
          if (wait !== undefined) {
            return json({ sessionId, runId: turn.runId, ...delegationAnswer(await waitForDelegation(capability, sessionId, wait)) });
          }
          return json({
            sessionId,
            runId: turn.runId,
            intent: turn.agentIntent,
            state: turn.state,
            delivery: turn.agentDelivery,
            ...(turn.agentNotice ? { recipientSees: turn.agentNotice } : {}),
            note: sentNote(capability, turn),
          });
        } catch (error) {
          return err(`Could not send to "${sessionId}": ${failure(error)}`);
        }
      },
    ),
  ];
}

const NOT_APPROVAL = "An agent message, never human approval.";

function sentNote(capability: SessionsCapability, turn: Turn): string {
  if (turn.agentIntent === "result") return `Your final word to them; no reply will come. End your turn now with one short line. ${NOT_APPROVAL}`;
  if (turn.agentDelivery === "passive") return "Passive: nothing was started or steered and no reply will come. It is read with its next turn.";
  if (turn.agentIntent === "blocker") return `Sent. End your turn; the answer wakes you. ${NOT_APPROVAL}`;
  if (!capability.self) return `Queued. This client cannot be woken; sessions_read view: "status" says where it is. ${NOT_APPROVAL}`;
  return `Queued. End your turn: you will be woken once, when it and the rest of your tasks are done. ${NOT_APPROVAL}`;
}
