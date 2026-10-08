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
import { SessionLookup, type SessionFacts } from "./session-lookup";
import { ROW } from "./transcript-fold";

export type AgentRowData = Pick<SessionChild, "sessionId" | "state"> & Partial<Pick<SessionChild, "title" | "provider" | "progress" | "summary" | "startedAt" | "endedAt">>;

export type AgentView = {
  state: SessionChildState;
  title: string;
  line?: string;
  provider?: ProviderDriverKind;
  startedAt?: number;
  endedAt?: number;
};

const DOT: Record<SessionChildState, string> = {
  working: "motion-safe:animate-pulse bg-primary",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
};

const agentPending = (agent: { state: SessionChildState }) => agent.state === "working" || agent.state === "waiting";

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

function Ticking({ from }: { from: number }) {
  const now = useNow(1_000);
  return fmtElapsed(seconds(now - from));
}

function Clock({ span, live }: { span: { startedAt?: number; endedAt?: number }; live: boolean }) {
  if (span.startedAt === undefined) return null;
  const shown = live ? <Ticking from={span.startedAt} /> : span.endedAt === undefined ? null : fmtElapsed(seconds(span.endedAt - span.startedAt));
  return shown && <span className="shrink-0 text-2xs tabular-nums text-muted-foreground" aria-label="Elapsed">{shown}</span>;
}

function Avatar({ agent, dot = true, className }: { agent: AgentView; dot?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted ring-2 ring-background", className)}>
      {agent.provider ? <ProviderIcon provider={agent.provider} size={12} /> : <BotIcon aria-hidden className="size-3 text-muted-foreground" />}
      {dot && <span role="img" aria-label={agent.state} className={cn("absolute -right-px -bottom-px size-1.5 rounded-full ring-2 ring-background", DOT[agent.state])} />}
    </span>
  );
}

function Chevron({ open }: { open?: boolean }) {
  return <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition-[color,transform] group-hover/agent:text-foreground", open && "rotate-90")} />;
}

function AgentFace({ agent, chevron, open }: { agent: AgentView; chevron: boolean; open?: boolean }) {
  return (
    <>
      <Avatar agent={agent} />
      <span className="min-w-0 shrink-0 truncate font-medium text-foreground">{agent.title}</span>
      {agent.line && <span className={cn("min-w-0 flex-1 truncate text-2xs", agent.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{agent.line}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Clock span={agent} live={agentPending(agent)} />
        {chevron && <Chevron open={open} />}
      </span>
    </>
  );
}

const FACE = cn(ROW, "group/agent gap-2");
const ACTIONABLE = "cursor-pointer transition-colors hover:bg-muted/50";

export function AgentDisclosure({ agent, children }: { agent: AgentView; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!children) return <div className={FACE} data-agent-state={agent.state}><AgentFace agent={agent} chevron={false} /></div>;
  return (
    <div className="flex min-w-0 flex-col">
      <button type="button" aria-expanded={open} aria-label={agent.title} data-agent-state={agent.state} onClick={() => setOpen((current) => !current)} className={cn(FACE, ACTIONABLE)}>
        <AgentFace agent={agent} chevron open={open} />
      </button>
      {open && <div className="ml-4 flex min-w-0 flex-col gap-0.5 border-l border-border/70 py-1 pl-3">{children}</div>}
    </div>
  );
}

export function sessionAgentView(agent: AgentRowData, facts: SessionFacts | undefined): AgentView {
  const line = agent.state === "working" ? agent.progress : agent.state === "waiting" ? "Waiting on you" : agent.summary;
  return {
    state: agent.state,
    title: agent.title?.trim() || facts?.title?.trim() || "Untitled session",
    ...(line ? { line } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.startedAt === undefined ? {} : { startedAt: agent.startedAt }),
    ...(agent.endedAt === undefined ? {} : { endedAt: agent.endedAt }),
  };
}

export function SessionAgentRow({ agent }: { agent: AgentRowData }) {
  const facts = useContext(SessionLookup)(agent.sessionId);
  const view = sessionAgentView(agent, facts);
  if (!facts?.href) return <div className={FACE} data-agent-state={agent.state}><AgentFace agent={view} chevron={false} /></div>;
  return (
    <Link href={facts.href} aria-label={`Open ${view.title}`} data-agent-state={agent.state} className={cn(FACE, ACTIONABLE)}>
      <AgentFace agent={view} chevron />
    </Link>
  );
}

function groupStatus(agents: readonly AgentView[]): string {
  const count = (test: (agent: AgentView) => boolean) => agents.filter(test).length;
  const parts = [
    [count(agentPending), "working"],
    [count((agent) => agent.state === "done"), "done"],
    [count((agent) => agent.state === "failed"), "failed"],
    [count((agent) => agent.state === "stopped"), "stopped"],
  ] as const;
  return parts.flatMap(([n, word]) => (n ? [`${n} ${word}`] : [])).join(" · ");
}

export function AgentCard({ agents, children }: { agents: readonly AgentView[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (agents.length < 2) return <div className="flex min-w-0 flex-col">{children}</div>;
  const live = agents.some(agentPending);
  const failed = agents.some((agent) => agent.state === "failed");
  const starts = agents.flatMap((agent) => (agent.startedAt === undefined ? [] : [agent.startedAt]));
  const ends = agents.flatMap((agent) => (agent.endedAt === undefined ? [] : [agent.endedAt]));
  const span = starts.length ? { startedAt: Math.min(...starts), ...(ends.length === agents.length ? { endedAt: Math.max(...ends) } : {}) } : {};
  return (
    <div className="flex min-w-0 flex-col" aria-label="Agents">
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={cn(FACE, ACTIONABLE)}>
        <span aria-hidden className="flex shrink-0 items-center -space-x-1.5">
          {agents.slice(0, 3).map((agent, index) => <Avatar key={index} agent={agent} dot={false} />)}
          {agents.length > 3 && <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground ring-2 ring-background">+{agents.length - 3}</span>}
        </span>
        <span className="shrink-0 font-medium text-foreground">{`${agents.length} subagents`}</span>
        <span className={cn("min-w-0 flex-1 truncate text-2xs", live ? "text-primary" : failed ? "text-destructive" : "text-muted-foreground")}>{groupStatus(agents)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Clock span={span} live={live} />
          <Chevron open={open} />
        </span>
      </button>
      {open && <div className="mt-0.5 mb-1 flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/60 bg-card/30 p-1">{children}</div>}
    </div>
  );
}

export function AgentRows({ agents }: { agents: readonly AgentRowData[] }) {
  const lookup = useContext(SessionLookup);
  if (agents.length === 0) return null;
  return (
    <AgentCard agents={agents.map((agent) => sessionAgentView(agent, lookup(agent.sessionId)))}>
      {agents.map((agent) => <SessionAgentRow key={agent.sessionId} agent={agent} />)}
    </AgentCard>
  );
}

export function FrozenAgentRows({ endings }: { endings: readonly BuilderEnding[] }) {
  const lookup = useContext(SessionLookup);
  const agents = endings.map((ending): AgentRowData => {
    const child = lookup(ending.sessionId)?.child;
    const times = child && !agentPending(child) ? { startedAt: child.startedAt, ...(child.endedAt === undefined ? {} : { endedAt: child.endedAt }) } : {};
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
