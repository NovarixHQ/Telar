"use client";

import { useContext, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import type { SessionChild, SessionChildState } from "@telar/engine-client";
import { ProviderIcon } from "@/features/providers";
import { useNow } from "@/ui/hooks/use-now";
import { cn } from "@/ui/utils";
import type { BuilderEnding } from "../builder-endings";
import { SessionLookup } from "./session-lookup";
import { ROW } from "./transcript-fold";

export type AgentRowData = Pick<SessionChild, "sessionId" | "state"> & Partial<Pick<SessionChild, "title" | "provider" | "progress" | "summary" | "startedAt" | "endedAt">>;

const STATES: readonly SessionChildState[] = ["working", "waiting", "done", "failed", "stopped"];

const DOT: Record<SessionChildState, string> = {
  working: "animate-pulse bg-primary",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
};

const pending = (agent: AgentRowData) => agent.state === "working" || agent.state === "waiting";

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Ticking({ from }: { from: number }) {
  const now = useNow(1_000);
  return elapsed(now - from);
}

function Clock({ agent }: { agent: AgentRowData }) {
  if (agent.startedAt === undefined) return null;
  const shown = pending(agent) ? <Ticking from={agent.startedAt} /> : agent.endedAt === undefined ? null : elapsed(agent.endedAt - agent.startedAt);
  return shown && <span className="shrink-0 font-mono text-3xs tabular-nums text-muted-foreground" aria-label="Elapsed">{shown}</span>;
}

function lineOf(agent: AgentRowData): string | undefined {
  if (agent.state === "working") return agent.progress;
  if (agent.state === "waiting") return "waiting on you";
  return agent.summary;
}

function AgentRow({ agent }: { agent: AgentRowData }) {
  const facts = useContext(SessionLookup)(agent.sessionId);
  const title = agent.title?.trim() || facts?.title?.trim() || "Untitled session";
  const line = lineOf(agent);
  return (
    <div className={ROW} data-agent-state={agent.state}>
      {agent.provider && <ProviderIcon provider={agent.provider} size={12} className="shrink-0" />}
      <span role="img" aria-label={agent.state} className={cn("size-1.5 shrink-0 rounded-full", DOT[agent.state])} />
      <span className="min-w-0 shrink-0 truncate">{title}</span>
      {line && <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{line}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Clock agent={agent} />
        {facts?.href && (
          <Link href={facts.href} aria-label={`Open ${title}`} className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRightIcon className="size-3.5" />
          </Link>
        )}
      </span>
    </div>
  );
}

function AgentGroup({ agents }: { agents: readonly AgentRowData[] }) {
  const live = agents.some(pending);
  const [open, setOpen] = useState(live);
  const counts = STATES.flatMap((state) => {
    const count = agents.filter((agent) => agent.state === state).length;
    return count ? [`${count} ${state}`] : [];
  });
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={cn(ROW, "hover:bg-muted/50", !live && "text-muted-foreground")}>
        <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 truncate">{[`${agents.length} agents`, ...counts].join(" · ")}</span>
      </button>
      {open && (
        <div className="ml-3 flex flex-col border-l border-border/70 pl-1.5">
          {agents.map((agent) => <AgentRow key={agent.sessionId} agent={agent} />)}
        </div>
      )}
    </div>
  );
}

/** One child as a row; several as a group under one header. */
export function AgentRows({ agents }: { agents: readonly AgentRowData[] }) {
  if (agents.length === 0) return null;
  return <div aria-label="Agents">{agents.length === 1 ? <AgentRow agent={agents[0]!} /> : <AgentGroup agents={agents} />}</div>;
}

/** Builders a notification reports ended, drawn as their rows stopped at that moment. */
export function FrozenAgentRows({ endings }: { endings: readonly BuilderEnding[] }) {
  const lookup = useContext(SessionLookup);
  const agents = endings.map((ending): AgentRowData => {
    const child = lookup(ending.sessionId)?.child;
    const times = child && !pending(child) ? { startedAt: child.startedAt, ...(child.endedAt === undefined ? {} : { endedAt: child.endedAt }) } : {};
    return {
      ...times,
      sessionId: ending.sessionId,
      state: ending.state,
      ...(child?.provider ? { provider: child.provider } : {}),
      ...((ending.title ?? child?.title) ? { title: ending.title ?? child?.title } : {}),
      ...(ending.summary ? { summary: ending.summary } : {}),
    };
  });
  return <AgentRows agents={agents} />;
}
