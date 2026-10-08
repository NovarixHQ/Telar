"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Project } from "@telar/engine-client";
import { type CommandPalettePage, useCommandKeys } from "@/features/commands";
import type { NewConversationTarget } from "@/features/projects";
import { useSidebar } from "@/ui/sidebar";
import { canvasHref, sessionHref, sessionKey, type SidebarSession } from "../session-list";
import type { RailData, RemoteProject } from "./use-rail-data";

const CommandPalette = dynamic(() => import("@/features/commands/components/command-palette").then((mod) => mod.CommandPalette));

export function pickerTargetsFor(projects: readonly Project[], remoteProjects: readonly RemoteProject[]): NewConversationTarget[] {
  return [
    ...projects.map((project) => ({
      id: project.id,
      name: project.name,
      ...(project.icon ? { icon: project.icon } : {}),
      ...(project.iconName ? { iconName: project.iconName } : {}),
      ...(project.root ? { root: project.root } : {}),
    })),
    ...remoteProjects.map((project) => ({
      id: project.id,
      name: project.name,
      ...(project.icon ? { icon: project.icon } : {}),
      ...(project.iconName ? { iconName: project.iconName } : {}),
      hostId: project.hostId,
      hostName: project.hostName,
    })),
  ];
}

export const composerTargetOf = (target: { id: string; hostId?: string }) => ({
  projectId: target.id,
  ...(target.hostId ? { hostId: target.hostId } : {}),
});

type PaletteState = { open: boolean; asked: boolean; page: CommandPalettePage; query: string };
type ComposerTarget = { projectId: string; hostId?: string };

function composerTargetFor(
  sessions: readonly SidebarSession[],
  activeSessionId: string | undefined,
  projects: readonly Project[],
  remoteProjects: readonly RemoteProject[],
): ComposerTarget | undefined {
  const active = sessions.find((session) => sessionKey(session) === activeSessionId);
  if (active?.projectId) return { projectId: active.projectId, ...(active.hostId ? { hostId: active.hostId } : {}) };
  const recent = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).find((session) => session.projectId);
  if (recent?.projectId) return { projectId: recent.projectId, ...(recent.hostId ? { hostId: recent.hostId } : {}) };
  if (projects[0]) return { projectId: projects[0].id };
  const remote = remoteProjects[0];
  return remote ? { projectId: remote.id, hostId: remote.hostId } : undefined;
}

export function useCommandHost({
  data,
  railRows,
  activeSessionId,
  railQuery = "",
  onNavigate = () => {},
}: {
  data: RailData;
  railRows: readonly SidebarSession[];
  activeSessionId: string | undefined;
  railQuery?: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { open: railOpen, toggleSidebar } = useSidebar();
  const [palette, setPalette] = useState<PaletteState>({ open: false, asked: false, page: "root", query: "" });
  const openPalette = (page: CommandPalettePage, seed = "") => setPalette({ open: true, asked: true, page, query: seed });

  const composerTarget = composerTargetFor(data.sessions, activeSessionId, data.projects, data.remoteProjects);
  const go = (href: string) => {
    onNavigate();
    router.push(href);
  };
  const startSession = (target = composerTarget) => go(target ? canvasHref(target.projectId, target.hostId) : "/");
  const openSession = (session: SidebarSession) => go(sessionHref(session));

  const pickerTargets = pickerTargetsFor(data.projects, data.remoteProjects);
  const soleTarget = pickerTargets.length === 1 ? pickerTargets[0] : undefined;
  const newConversation = () => {
    if (soleTarget) startSession(composerTargetOf(soleTarget));
    else openPalette("projects");
  };

  const run = useCommandKeys(
    railRows,
    {
      "new-conversation": () => newConversation(),
      "new-conversation-in": () => openPalette("projects"),
      "add-project": () => openPalette("sources"),
      "search-sessions": () =>
        setPalette((current) => (current.open ? { ...current, open: false } : { open: true, asked: true, page: "root", query: railQuery })),
      "toggle-rail": () => toggleSidebar(),
    },
    activeSessionId,
  );

  const element = palette.asked ? (
    <Suspense fallback={null}>
      <CommandPalette
        open={palette.open}
        page={palette.page}
        query={palette.query}
        onOpenChange={(open) => setPalette((current) => ({ ...current, open, asked: current.asked || open }))}
        targets={pickerTargets}
        sessions={data.sessions}
        railOpen={railOpen}
        onRun={run}
        onChooseProject={(target) => startSession(composerTargetOf(target))}
        onOpenSession={openSession}
        onNavigate={go}
        onRegistered={({ projectId, hostId }) => startSession({ projectId, ...(hostId ? { hostId } : {}) })}
      />
    </Suspense>
  ) : null;

  return { element, run, openPalette, composerTarget, startSession, openSession, pickerTargets, soleTarget, go };
}
