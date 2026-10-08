"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BotIcon, FolderGit2Icon, FolderGitIcon, GitBranchIcon, GitCompareIcon, SquareTerminalIcon } from "lucide-react";
import { type Session, type SessionChild, type SessionDiff, workspacePath } from "@telar/engine-client";
import { OpenWorkspaceButton } from "@/features/files";
import { PublishBox, useGitHubReady } from "@/features/git";
import { isOpenTerminal, openTerminal, RunHeaderControl, statusLabel, type RunView } from "@/features/terminal";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";
import { sessionHref } from "../../session-list";
import type { useCockpitPanel } from "../hooks/use-cockpit-panel";
import { useWorkspaceCardData, useWorkspaceCardOpen } from "../hooks/use-workspace-card";

const CHILD_STATE: Record<SessionChild["state"], string> = { working: "Running", waiting: "Waiting", done: "Done", failed: "Failed", stopped: "Stopped" };

const ROW = "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs outline-none";
const ACTION_ROW = cn(ROW, "transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring");

const basename = (path: string) => path.replace(/\/+$/, "").split("/").at(-1) || path;

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="px-2 py-2 not-first:border-t not-first:border-border/60">
      <h3 className="mb-1 flex justify-between px-1.5 text-2xs font-medium text-muted-foreground">
        {title}
        {meta && <span className="font-normal">{meta}</span>}
      </h3>
      {children}
    </section>
  );
}

export type WorkspaceCardViewProps = {
  path: string | undefined;
  worktree: boolean;
  diff: SessionDiff | undefined;
  terminals: readonly RunView[];
  backgroundTasks: number;
  agents: readonly SessionChild[];
  /** The Run menu and the editor opener, which read the engine themselves. */
  run?: ReactNode;
  editor?: ReactNode;
  publish?: ReactNode;
  onOpenTerminal: (run: RunView) => void;
  onOpenChanges?: () => void;
  onOpenAgent: (agent: SessionChild) => void;
};

/** Where this conversation works, what runs there, its branch and the builders it tasked. */
export function WorkspaceCardView(props: WorkspaceCardViewProps) {
  const { path, worktree, diff, backgroundTasks, agents } = props;
  const open = props.terminals.filter(isOpenTerminal);
  const working = agents.filter((agent) => agent.state === "working").length;
  return (
    <div role="complementary" aria-label="Workspace card" className="w-72 overflow-hidden rounded-xl border border-border/80 bg-popover/95 text-popover-foreground shadow-2 backdrop-blur-xl">
      <Section title="Workspace">
        <div className={ROW}>
          {worktree ? <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <FolderGitIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate font-mono" title={path}>
            {path ? basename(path) : "Project"}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground">{worktree ? "Worktree" : "Checkout"}</span>
        </div>
        {(props.editor || props.run) && (
          <div className="flex items-center gap-1.5 px-1.5 py-1">
            {props.run}
            {props.editor}
          </div>
        )}
        {open.map((run) => (
          <button key={run.terminalId} type="button" className={ACTION_ROW} onClick={() => props.onOpenTerminal(run)}>
            <SquareTerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{run.title}</span>
            <span className="shrink-0 text-2xs text-muted-foreground">{statusLabel(run)}</span>
          </button>
        ))}
        {backgroundTasks > 0 && (
          <div className={ROW}>
            <SquareTerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{backgroundTasks === 1 ? "1 background process" : `${backgroundTasks} background processes`}</span>
          </div>
        )}
      </Section>
      {diff?.repository && (
        <Section title="Version control">
          <div className={ROW}>
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono">{diff.branch ?? "no branch"}</span>
            {(diff.ahead !== undefined || diff.behind !== undefined) && (
              <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
                ↑{diff.ahead ?? 0} ↓{diff.behind ?? 0}
              </span>
            )}
          </div>
          {props.publish}
          <button type="button" className={ACTION_ROW} disabled={!props.onOpenChanges} onClick={props.onOpenChanges}>
            <GitCompareIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">Changes</span>
            <span className="shrink-0 font-mono text-2xs tabular-nums">
              <span className="text-success">+{diff.linesAdded}</span> <span className="text-destructive">−{diff.linesRemoved}</span>
            </span>
          </button>
        </Section>
      )}
      {agents.length > 0 && (
        <Section title="Agents" meta={working > 0 ? `${working} running` : undefined}>
          {agents.map((agent) => (
            <button key={agent.sessionId} type="button" className={ACTION_ROW} onClick={() => props.onOpenAgent(agent)}>
              <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{agent.title ?? "Untitled"}</span>
              <span className={cn("shrink-0 text-2xs", agent.state === "working" ? "text-primary" : "text-muted-foreground")}>{CHILD_STATE[agent.state]}</span>
            </button>
          ))}
        </Section>
      )}
    </div>
  );
}

/** Floats over the conversation's top right. Kept mounted while closed: the Run menu's feed is what reveals new terminals. */
export function WorkspaceCard({ hostId, session, agents, busy, backgroundTasks, panel, onRunTerminals }: {
  hostId: string;
  session: Session;
  agents: readonly SessionChild[];
  busy: boolean;
  backgroundTasks: number;
  panel: Pick<ReturnType<typeof useCockpitPanel>, "updatePanel" | "showPanelTab">;
  onRunTerminals: (terminals: readonly RunView[]) => void;
}) {
  const router = useRouter();
  const { open } = useWorkspaceCardOpen();
  const path = workspacePath(session.workspace);
  const { diff, reload } = useWorkspaceCardData(hostId, session.id, open);
  const [terminals, setTerminals] = useState<readonly RunView[]>([]);
  const publishable = Boolean(diff?.branch) && diff?.shared !== true;
  const github = useGitHubReady(open && publishable, session.projectId);
  const api = createEngineApi(hostFetcher(hostId));
  return (
    <div className={cn("app-no-drag absolute top-3 right-3 z-20", !open && "hidden")}>
      <WorkspaceCardView
        path={path}
        worktree={session.workspace.mode === "worktree"}
        diff={diff}
        terminals={terminals}
        backgroundTasks={backgroundTasks}
        agents={agents}
        {...(path === undefined
          ? {}
          : {
              run: (
                <RunHeaderControl
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
              editor: <OpenWorkspaceButton path={path} hostId={hostId} />,
            })}
        {...(diff?.branch && publishable
          ? {
              publish: (
                <PublishBox
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
        onOpenTerminal={(run) => panel.updatePanel((current) => openTerminal(current, run, "terminal"))}
        onOpenChanges={() => panel.showPanelTab("diff")}
        onOpenAgent={(agent) => router.push(sessionHref({ id: agent.sessionId, projectId: session.projectId, hostId }))}
      />
    </div>
  );
}

export function WorkspaceCardToggle() {
  const { open, toggle } = useWorkspaceCardOpen();
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Workspace" aria-pressed={open} title="Workspace (⌥⌘W)" onClick={toggle} className={cn("text-muted-foreground", open && "bg-accent text-foreground")}>
      <FolderGit2Icon />
    </Button>
  );
}
