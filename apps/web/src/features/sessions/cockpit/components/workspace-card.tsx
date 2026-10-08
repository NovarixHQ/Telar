"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BotIcon, ChevronDownIcon, CopyIcon, FolderGitIcon, GitBranchIcon, GitCompareIcon, MessageSquarePlusIcon } from "lucide-react";
import { type ProviderDriverKind, type Session, type SessionChild, type SessionDiff, workspacePath } from "@telar/engine-client";
import { OpenWorkspaceRow } from "@/features/files";
import { ProviderIcon } from "@/features/providers";
import { PublishRows, useGitHubReady } from "@/features/git";
import { isOpenTerminal, openTerminal, RunRow, statusLabel, type RunView } from "@/features/terminal";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { ActionRow, RowMeta, SplitRow, SplitRowChevron } from "@/ui/action-row";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { cn } from "@/ui/utils";
import { canvasHref, sessionHref } from "../../session-list";
import type { useCockpitPanel } from "../hooks/use-cockpit-panel";
import type { CardSubagent } from "../model";
import { useWorkspaceCardData, useWorkspaceCardOpen, type CardPlacement } from "../hooks/use-workspace-card";

const CHILD_STATE: Record<SessionChild["state"], string> = { working: "Running", waiting: "Waiting", done: "Done", failed: "Failed", stopped: "Stopped" };

const ROW = "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-xs-plus outline-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

const basename = (path: string) => path.replace(/\/+$/, "").split("/").at(-1) || path;

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="px-2 pt-2 pb-2.5 not-first:border-t not-first:border-border/65">
      <h3 className="mb-1 flex justify-between px-2.5 text-2xs font-medium text-muted-foreground">
        {title}
        {meta && <span className="font-normal">{meta}</span>}
      </h3>
      {children}
    </section>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SplitRowChevron aria-label={label} />} />
      <DropdownMenuContent align="end" className="min-w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type WorkspaceCardViewProps = {
  path: string | undefined;
  worktree: boolean;
  diff: SessionDiff | undefined;
  terminals: readonly RunView[];
  backgroundTasks: number;
  agents: readonly SessionChild[];
  subagents?: readonly CardSubagent[];
  driver?: ProviderDriverKind;
  run?: ReactNode;
  editor?: ReactNode;
  publish?: ReactNode;
  onNewSession?: () => void;
  onOpenTerminal: (run: RunView) => void;
  onOpenChanges?: () => void;
  onOpenAgent: (agent: SessionChild) => void;
};

/** Where this conversation works, what runs there, its branch and the builders it tasked. */
export function WorkspaceCardView(props: WorkspaceCardViewProps) {
  const { path, worktree, diff, backgroundTasks, agents } = props;
  const open = props.terminals.filter(isOpenTerminal);
  const subagents = props.subagents ?? [];
  const working = [...agents, ...subagents].filter((agent) => agent.state === "working").length;
  const out = (agent: { state: SessionChild["state"] }) => agent.state === "working" || agent.state === "waiting";
  const builderRow = (agent: SessionChild) => (
    <ActionRow key={agent.sessionId} onClick={() => props.onOpenAgent(agent)}>
      <BotIcon />
      <span className="min-w-0 flex-1 truncate">{agent.title ?? "Untitled"}</span>
      <RowMeta className={cn("font-sans", agent.state === "working" && "text-primary")}>{CHILD_STATE[agent.state]}</RowMeta>
    </ActionRow>
  );
  const subagentRow = (agent: CardSubagent) => (
    <div key={agent.id} className={cn(ROW, "text-foreground")}>
      {props.driver ? <ProviderIcon provider={props.driver} size={16} className="shrink-0" /> : <BotIcon />}
      <span className="min-w-0 flex-1 truncate">{agent.title}</span>
      <RowMeta className={cn("font-sans", agent.state === "working" && "text-primary")}>{CHILD_STATE[agent.state]}</RowMeta>
    </div>
  );
  const branch = diff?.branch;
  const newSession = props.onNewSession && (
    <DropdownMenuItem onClick={props.onNewSession}>
      <MessageSquarePlusIcon />
      {branch ? `New session on ${branch}` : "New session in this project"}
    </DropdownMenuItem>
  );
  return (
    <div role="complementary" aria-label="Workspace card" className="w-72 overflow-hidden rounded-2xl border border-border/80 bg-popover/95 text-popover-foreground shadow-2 backdrop-blur-xl">
      <Section title="Workspace">
        <SplitRow menu={<RowMenu label="Workspace actions">{newSession}<CopyItem label="Copy path" value={path} /></RowMenu>}>
          <div className={cn(ROW, "flex-1 font-medium")} title={path}>
            {worktree ? <GitBranchIcon /> : <FolderGitIcon />}
            <span className="min-w-0 flex-1 truncate">{worktree ? "Worktree" : "Checkout"}</span>
            <RowMeta className="max-w-28 truncate">{path ? basename(path) : "Project"}</RowMeta>
          </div>
        </SplitRow>
        {props.editor}
        {props.run}
        {open.map((run) => (
          <ActionRow key={run.terminalId} className="h-7 pl-9 font-normal" onClick={() => props.onOpenTerminal(run)}>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success ring-3 ring-success/20" />
            <span className="min-w-0 flex-1 truncate">{run.title}</span>
            <RowMeta className="font-sans">{statusLabel(run)}</RowMeta>
          </ActionRow>
        ))}
        {backgroundTasks > 0 && (
          <div className={cn(ROW, "h-7 pl-9 text-muted-foreground")}>
            <span className="min-w-0 flex-1 truncate">{backgroundTasks === 1 ? "1 background process" : `${backgroundTasks} background processes`}</span>
          </div>
        )}
      </Section>
      {diff?.repository && (
        <Section title="Version control">
          <SplitRow
            menu={
              <RowMenu label="Branch actions">
                {diff.base && (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-mono text-2xs">From {diff.base}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                )}
                {newSession}
                {branch && <CopyItem label="Copy branch name" value={branch} />}
              </RowMenu>
            }
          >
            <div className={cn(ROW, "flex-1 font-medium")} title={diff.base ? `${branch ?? "no branch"} — from ${diff.base}` : undefined}>
              <GitBranchIcon />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{branch ?? "no branch"}</span>
              {(diff.ahead !== undefined || diff.behind !== undefined) && (
                <RowMeta>
                  ↑{diff.ahead ?? 0} ↓{diff.behind ?? 0}
                </RowMeta>
              )}
            </div>
          </SplitRow>
          {props.publish}
          <ActionRow disabled={!props.onOpenChanges} onClick={props.onOpenChanges}>
            <GitCompareIcon />
            <span className="flex-1">Changes</span>
            <RowMeta>
              <span className="text-success">+{diff.linesAdded}</span> <span className="text-destructive">−{diff.linesRemoved}</span>
            </RowMeta>
          </ActionRow>
        </Section>
      )}
      {agents.length + subagents.length > 0 && (
        <Section title="Agents" meta={working > 0 ? `${working} running` : undefined}>
          {agents.filter(out).map(builderRow)}
          {subagents.filter(out).map(subagentRow)}
          <FinishedAgents count={agents.filter((agent) => !out(agent)).length + subagents.filter((agent) => !out(agent)).length}>
            {agents.filter((agent) => !out(agent)).map(builderRow)}
            {subagents.filter((agent) => !out(agent)).map(subagentRow)}
          </FinishedAgents>
        </Section>
      )}
    </div>
  );
}

function FinishedAgents({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <ActionRow aria-expanded={open} onClick={() => setOpen((current) => !current)} className="text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{`Finished agents (${count})`}</span>
        <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
      </ActionRow>
      {open && children}
    </>
  );
}

function CopyItem({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(value)}>
      <CopyIcon />
      {label}
    </DropdownMenuItem>
  );
}

function useDismiss(active: boolean, close: () => void) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || frame.current?.contains(target)) return;
      if (target.closest('[aria-label="Workspace"], [data-slot$="-content"], [role="menu"], [role="dialog"]')) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [active, close]);
  return frame;
}

export function WorkspaceCardFrame({ open, placement, onClose, children }: { open: boolean; placement: CardPlacement; onClose: () => void; children: ReactNode }) {
  const frame = useDismiss(open && placement === "popover", onClose);
  return (
    <div
      ref={frame}
      data-placement={placement}
      className={cn("app-no-drag absolute right-3 max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl [&>*]:max-w-full", placement === "docked" ? "top-3 z-20" : "top-1 z-30 shadow-3", !open && "hidden")}
    >
      {children}
    </div>
  );
}

/** Kept mounted while closed: the Run row's feed is what reveals new terminals. */
export function WorkspaceCard({ hostId, session, agents, subagents, busy, backgroundTasks, panel, onRunTerminals }: {
  hostId: string;
  session: Session;
  agents: readonly SessionChild[];
  subagents: readonly CardSubagent[];
  busy: boolean;
  backgroundTasks: number;
  panel: Pick<ReturnType<typeof useCockpitPanel>, "updatePanel" | "showPanelTab" | "flat">;
  onRunTerminals: (terminals: readonly RunView[]) => void;
}) {
  const router = useRouter();
  const { open, placement, close } = useWorkspaceCardOpen();
  const path = workspacePath(session.workspace);
  const { diff, reload } = useWorkspaceCardData(hostId, session.id, open, session.workspace.mode === "local", busy);
  const [terminals, setTerminals] = useState<readonly RunView[]>([]);
  const publishable = Boolean(diff?.branch) && diff?.shared !== true;
  const github = useGitHubReady(open && publishable, session.projectId);
  const api = createEngineApi(hostFetcher(hostId));
  return (
    <WorkspaceCardFrame open={open} placement={placement} onClose={close}>
      <WorkspaceCardView
        path={path}
        worktree={session.workspace.mode === "worktree"}
        diff={diff}
        terminals={terminals}
        backgroundTasks={backgroundTasks}
        agents={agents}
        subagents={subagents}
        driver={session.driver}
        {...(path === undefined
          ? {}
          : {
              run: (
                <RunRow
                  key={`${hostId}:${session.id}`}
                  sessionId={session.id}
                  hostId={hostId}
                  onWatchOutput={() => panel.showPanelTab("terminal")}
                  onTerminals={(next) => {
                    setTerminals(next);
                    onRunTerminals(next);
                  }}
                />
              ),
              editor: <OpenWorkspaceRow path={path} hostId={hostId} />,
            })}
        {...(diff?.branch && publishable
          ? {
              publish: (
                <PublishRows
                  sendPush={() => api.pushSessionBranch(session.id)}
                  sendPullRequest={(input) => api.openSessionPullRequest(session.id, input)}
                  {...(github === undefined ? {} : { github })}
                  branch={diff.branch}
                  {...(diff.ahead === undefined ? {} : { ahead: diff.ahead })}
                  commitsSinceBase={diff.commits.length}
                  busy={busy}
                  suggestion={session.title?.trim() || "Session work"}
                  onPublished={() => void reload()}
                />
              ),
            }
          : {})}
        {...(session.projectId ? { onNewSession: () => router.push(canvasHref(session.projectId!, hostId, diff?.branch ? { baseRef: diff.branch } : undefined)) } : {})}
        onOpenTerminal={(run) => panel.updatePanel((current) => openTerminal(current, run, "terminal", panel.flat))}
        onOpenChanges={() => panel.showPanelTab("diff")}
        onOpenAgent={(agent) => router.push(sessionHref({ id: agent.sessionId, projectId: session.projectId, hostId }))}
      />
    </WorkspaceCardFrame>
  );
}
