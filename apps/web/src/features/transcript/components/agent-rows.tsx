"use client";

import { useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { BotIcon, ChevronRightIcon } from "lucide-react";
import type { ProviderDriverKind, SessionChild, SessionChildState } from "@telar/engine-client";
import { ProviderIcon } from "@/features/providers";
import { fmtElapsed } from "@/ui/format";
import { useNow } from "@/ui/hooks/use-now";
import { cn } from "@/ui/utils";
import type { BuilderEnding } from "../builder-endings";
import { SessionLookup } from "./session-lookup";
import { ROW } from "./transcript-fold";

export type AgentRowData = Pick<SessionChild, "sessionId" | "state"> & Partial<Pick<SessionChild, "title" | "provider" | "progress" | "summary" | "startedAt" | "endedAt">>;

export type AgentView = {
  state: SessionChildState;
  title: string;
  role?: string;
  line?: string;
  provider?: ProviderDriverKind;
  startedAt?: number;
  endedAt?: number;
};

const STATES: readonly SessionChildState[] = ["working", "waiting", "done", "failed", "stopped"];

const DOT: Record<SessionChildState, string> = {
  working: "motion-safe:animate-pulse bg-primary",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
};

const STATE_LINE: Record<SessionChildState, string> = {
  working: "Working",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const pending = (agent: { state: SessionChildState }) => agent.state === "working" || agent.state === "waiting";

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

function Ticking({ from }: { from: number }) {
  const now = useNow(1_000);
  return fmtElapsed(seconds(now - from));
}

function Clock({ agent }: { agent: AgentView }) {
  if (agent.startedAt === undefined) return null;
  const shown = pending(agent) ? <Ticking from={agent.startedAt} /> : agent.endedAt === undefined ? null : fmtElapsed(seconds(agent.endedAt - agent.startedAt));
  return shown && <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label="Elapsed">{shown}</span>;
}

function AgentFace({ agent, chevron, open }: { agent: AgentView; chevron: boolean; open?: boolean }) {
  const failed = agent.state === "failed";
  return (
    <>
      <span className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted ring-2 ring-background">
        {agent.provider ? <ProviderIcon provider={agent.provider} size={14} /> : <BotIcon aria-hidden className="size-3.5 text-muted-foreground" />}
        <span role="img" aria-label={agent.state} className={cn("absolute -right-px -bottom-px size-2 rounded-full ring-2 ring-background", DOT[agent.state])} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-xs font-medium text-foreground">{agent.title}</span>
          {agent.role && <span className="shrink-0 text-3xs text-muted-foreground">{agent.role}</span>}
        </span>
        <span className={cn("block truncate text-2xs leading-relaxed", failed ? "text-destructive" : "text-muted-foreground")}>{agent.line || STATE_LINE[agent.state]}</span>
      </span>
      <Clock agent={agent} />
      {chevron && <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition-[color,transform] group-hover/agent:text-foreground", open && "rotate-90")} />}
    </>
  );
}

const FACE = cn(ROW, "group/agent gap-2.5 py-1.5");
const ACTIONABLE = "cursor-pointer transition-colors hover:bg-muted/50";

export function AgentDisclosure({ agent, children }: { agent: AgentView; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!children) return <div className={FACE} data-agent-state={agent.state}><AgentFace agent={agent} chevron={false} /></div>;
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} aria-label={agent.title} data-agent-state={agent.state} onClick={() => setOpen((current) => !current)} className={cn(FACE, ACTIONABLE)}>
        <AgentFace agent={agent} chevron open={open} />
      </button>
      {open && <div className="ml-4.5 flex min-w-0 flex-col gap-0.5 border-l border-border/70 py-1 pl-3">{children}</div>}
    </div>
  );
}

function lineOf(agent: AgentRowData): string | undefined {
  if (agent.state === "working") return agent.progress;
  if (agent.state === "waiting") return undefined;
  return agent.summary;
}

function SessionAgentRow({ agent }: { agent: AgentRowData }) {
  const facts = useContext(SessionLookup)(agent.sessionId);
  const view: AgentView = {
    state: agent.state,
    title: agent.title?.trim() || facts?.title?.trim() || "Untitled session",
    ...(lineOf(agent) ? { line: lineOf(agent) } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.startedAt === undefined ? {} : { startedAt: agent.startedAt }),
    ...(agent.endedAt === undefined ? {} : { endedAt: agent.endedAt }),
  };
  if (!facts?.href) return <div className={FACE} data-agent-state={agent.state}><AgentFace agent={view} chevron={false} /></div>;
  return (
    <Link href={facts.href} aria-label={`Open ${view.title}`} data-agent-state={agent.state} className={cn(FACE, ACTIONABLE)}>
      <AgentFace agent={view} chevron />
    </Link>
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
          {agents.map((agent) => <SessionAgentRow key={agent.sessionId} agent={agent} />)}
        </div>
      )}
    </div>
  );
}

export function AgentRows({ agents }: { agents: readonly AgentRowData[] }) {
  if (agents.length === 0) return null;
  return <div aria-label="Agents">{agents.length === 1 ? <SessionAgentRow agent={agents[0]!} /> : <AgentGroup agents={agents} />}</div>;
}

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
