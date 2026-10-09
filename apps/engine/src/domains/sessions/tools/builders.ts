import type { SessionChild } from "@telar/engine-client";
import { err, failure, json } from "../../agent-tools";
import type { SessionsCapability } from "./shared";

const ENDED_SHOWN = 10;

type WorkState = "working" | "blocked" | "waiting on you" | "done" | "done without a result" | "failed" | "stopped";

// A result's fetch names the parent's copy of the message; an ending without one names the child's own run.
function workState(child: SessionChild): WorkState {
  if (child.state === "working") return child.blocked ? "blocked" : "working";
  if (child.state === "waiting") return "waiting on you";
  if (child.state === "done" && child.fetch?.sessionId === child.sessionId) return "done without a result";
  return child.state;
}

function row(child: SessionChild) {
  return {
    id: child.sessionId,
    ...(child.title ? { title: child.title } : {}),
    workState: workState(child),
    ...(child.progress ? { doing: child.progress } : {}),
    ...(child.summary ? { summary: child.summary } : {}),
    ...(child.fetch ? { read: child.fetch } : {}),
    updatedAt: child.updatedAt ?? child.endedAt ?? child.startedAt,
  };
}

/** The sessions this one tasked: every one still out and the latest that ended. Reading your own spends their ending notices. */
export async function buildersView(capability: SessionsCapability, sessionId: string) {
  let children: SessionChild[];
  try {
    children = await capability.builders(sessionId);
  } catch (error) {
    return err(`Could not read the builders of "${sessionId}": ${failure(error)}`);
  }
  const out = children.filter((child) => child.state === "working" || child.state === "waiting");
  const ended = children.filter((child) => child.endedAt !== undefined).sort((a, b) => b.endedAt! - a.endedAt!);
  const shown = ended.slice(0, ENDED_SHOWN);
  if (capability.self?.sessionId === sessionId) {
    for (const child of shown) if (child.fetch) await capability.acknowledge(child.sessionId, child.fetch.runId);
  }
  return json({
    sessionId,
    view: "builders",
    builders: [...out, ...shown.reverse()].map(row),
    ...(ended.length > shown.length ? { endedNotShown: ended.length - shown.length } : {}),
    note: children.length === 0 ? "This session has tasked no one." : "read names where each result or ending is; sessions_read it for the whole text.",
  });
}
