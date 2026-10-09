"use client";

import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import { GitBranchIcon } from "lucide-react";
import { HostMark } from "@/features/hosts";
import { ProjectAvatar } from "@/features/projects";
import { ProviderIcon } from "@/features/providers";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { rowSubtitle } from "../session-activity";
import type { SidebarSession } from "../session-list";

export function RowBody({
  session,
  showProject,
  marks,
  trailing,
  reserve = false,
}: {
  session: SidebarSession;
  showProject: boolean;
  marks: ReactNode;
  trailing: ReactNode;
  reserve?: boolean;
}) {
  const subtitle = rowSubtitle(session, { projectShown: showProject });
  return (
    <span className="min-w-0 flex-1 space-y-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <HostMark hostId={session.hostId} hostName={session.hostName} />
        {marks}
        {showProject && session.projectName ? (
          <>
            <ProjectAvatar
              name={session.projectName}
              {...(session.projectId ? { projectId: session.projectId } : {})}
              {...(session.hostId ? { hostId: session.hostId } : {})}
              {...(session.projectIcon ? { icon: session.projectIcon } : {})}
              {...(session.projectIconName ? { iconName: session.projectIconName } : {})}
              size={12}
            />
            <span className="min-w-0 flex-1 truncate text-2xs text-sidebar-foreground/50">{session.projectName}</span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        {trailing}
      </span>
      <span className="block truncate text-sm font-medium leading-snug text-sidebar-foreground">{session.title || "Untitled session"}</span>
      <span className="flex h-4 min-w-0 items-center gap-1.5 text-2xs text-sidebar-foreground/45">
        {subtitle?.kind === "branch" ? <GitBranchIcon className="size-3 shrink-0" /> : null}
        <span className="min-w-0 flex-1 truncate">{subtitle?.text}</span>
        {reserve ? <span aria-hidden className="w-7 shrink-0" /> : null}
        <span className="shrink-0 opacity-60">
          <ProviderIcon provider={session.driver} size={11} />
        </span>
      </span>
    </span>
  );
}

export function MiniBody({ session, marks, trailing }: { session: SidebarSession; marks: ReactNode; trailing: ReactNode }) {
  return (
    <>
      <HostMark hostId={session.hostId} hostName={session.hostName} size={14} />
      {marks}
      <span className="shrink-0 opacity-60">
        <ProviderIcon provider={session.driver} size={12} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs-plus text-sidebar-foreground">{session.title || "Untitled session"}</span>
      {trailing}
    </>
  );
}

export function RowLink({
  id,
  href,
  warm,
  searchable,
  searchSelected,
  active,
  compact,
  plain,
  details,
  anchor,
  onRename,
  children,
}: {
  id: string;
  href: string;
  warm: boolean;
  searchable: boolean;
  searchSelected: boolean;
  active: boolean;
  compact: boolean;
  plain: boolean;
  details: ReactNode;
  anchor: RefObject<HTMLDivElement | null>;
  onRename: () => void;
  children: ReactNode;
}) {
  const linkProps = {
    href,
    prefetch: warm,
    draggable: false,
    role: searchable ? "option" : undefined,
    "aria-selected": searchable ? searchSelected : undefined,
    "aria-current": active ? ("page" as const) : undefined,
    onDoubleClick: (event: React.MouseEvent) => {
      event.preventDefault();
      onRename();
    },
    className: `flex min-w-0 flex-1 items-center gap-2 px-2 ${compact ? "py-1.5" : "py-2.5"} text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`,
  };
  if (plain) {
    return (
      <Link id={id} {...linkProps}>
        {children}
      </Link>
    );
  }
  return (
    <HoverCard>
      <HoverCardTrigger id={id} render={<Link {...linkProps} />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={8}
        positionMethod="fixed"
        collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
        className="w-64 overflow-hidden p-0 duration-150"
      >
        {details}
      </HoverCardContent>
    </HoverCard>
  );
}
