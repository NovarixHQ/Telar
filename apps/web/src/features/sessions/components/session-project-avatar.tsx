"use client";

import { ProjectAvatar } from "@/features/projects";
import type { SidebarSession } from "../session-list";

export function SessionProjectAvatar({ session, size = 12 }: { session: Pick<SidebarSession, "projectName" | "projectId" | "hostId" | "projectIcon" | "projectIconName">; size?: number }) {
  return (
    <ProjectAvatar
      {...(session.projectName ? { name: session.projectName } : {})}
      {...(session.projectId ? { projectId: session.projectId } : {})}
      {...(session.hostId ? { hostId: session.hostId } : {})}
      {...(session.projectIcon ? { icon: session.projectIcon } : {})}
      {...(session.projectIconName ? { iconName: session.projectIconName } : {})}
      size={size}
    />
  );
}
