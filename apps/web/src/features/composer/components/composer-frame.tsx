"use client";

import type { ProjectAvailability } from "@telar/engine-client";
import { FreshGreeting } from "./fresh-greeting";
import { ResumePicker } from "./resume-picker";
import { WorkspaceEnvironment } from "@/features/worktrees";
import { cn } from "@/ui/utils";
import { ComposerNote } from "./composer-chrome";
import { BackgroundPresence } from "./context-pill";
import type { ComposerProps } from "./composer-props";

/** Above the card: the fresh canvas's greeting and `/resume` picker, background work, and a stash note. */
export function ComposerHead({
  props,
  resuming,
  onResuming,
  note,
  onDismissNote,
}: {
  props: ComposerProps;
  resuming: boolean;
  onResuming: (open: boolean) => void;
  note: string | undefined;
  onDismissNote: () => void;
}) {
  const { fresh, projectId, projectName, onAdopt, session } = props;
  return (
    <>
      {fresh && projectId && <FreshGreeting projectId={projectId} {...(projectName ? { projectName } : {})} />}
      {fresh && onAdopt && (
        <ResumePicker
          open={resuming}
          onOpenChange={onResuming}
          onPick={onAdopt}
          {...(session?.providerInstanceId ? { instanceId: session.providerInstanceId } : {})}
        />
      )}
      <BackgroundPresence count={props.backgroundTasks} onStop={props.onStopBackground} />
      {note && <ComposerNote note={note} onDismiss={onDismissNote} />}
    </>
  );
}

/** Below the card: where the message lands. `hidden` slides it behind the card, keeping its height. */
export function ComposerFoot({
  props,
  hidden,
  onAvailability,
}: {
  props: ComposerProps;
  hidden: boolean;
  onAvailability: (availability: Exclude<ProjectAvailability, "available"> | undefined) => void;
}) {
  const { projectId, projectName, session, envMode, onEnvMode, pendingBase, onBase } = props;
  return (
    <div
      data-slot="composer-foot"
      inert={hidden}
      className={cn("relative z-0 transition-[translate,opacity] duration-300 ease-out motion-reduce:transition-none", hidden && "-translate-y-full opacity-0")}
    >
      {projectId && (
        <WorkspaceEnvironment
          projectId={projectId}
          onAvailability={onAvailability}
          {...(projectName ? { projectName } : {})}
          {...(session ? { session } : {})}
          {...(envMode ? { envMode } : {})}
          {...(onEnvMode ? { onEnvMode } : {})}
          {...(pendingBase ? { pendingBase } : {})}
          {...(onBase ? { onBase } : {})}
        />
      )}
    </div>
  );
}
