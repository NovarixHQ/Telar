import type { ComponentProps } from "react";
import type { ProviderDriverKind, Session } from "@telar/engine-client";
import type { ModelChoice } from "@telar/client/providers";
import { recallablePrompts, type Composer } from "@/features/composer";
import { wakeLabel } from "../../session-settling";
import type { useComposerDraft } from "../hooks/use-composer-draft";
import type { useDraftConfig } from "../hooks/use-draft-config";
import type { useSessionActions } from "../hooks/use-session-actions";
import type { useSettling } from "../hooks/use-settling";
import type { useSubmit } from "../hooks/use-submit";
import type { useTranscriptModel } from "../hooks/use-transcript-model";

export function composerProps({ fresh, solo, session, projectId, projectName, compact, contextNoticePercent, builders, composer, draft, actions, settling, model, submit }: {
  fresh: boolean;
  solo: boolean;
  session: Session | undefined;
  projectId: string | undefined;
  projectName: string | undefined;
  compact: boolean;
  contextNoticePercent: ComponentProps<typeof Composer>["contextNoticePercent"];
  builders: ComponentProps<typeof Composer>["builders"];
  composer: ReturnType<typeof useComposerDraft>;
  draft: ReturnType<typeof useDraftConfig>;
  actions: ReturnType<typeof useSessionActions>;
  settling: ReturnType<typeof useSettling>;
  model: ReturnType<typeof useTranscriptModel>;
  submit: ReturnType<typeof useSubmit>;
}): ComponentProps<typeof Composer> {
  const { composerQuestion, newestUsage } = model;
  const runtimeMode = session?.runtimeMode ?? (fresh ? draft.runtimeMode : undefined);
  return {
    draft: composer.draft,
    // A fresh canvas is ready: the message typed is what creates the session.
    ready: fresh || Boolean(session),
    compact,
    attachments: composer.attachments,
    onAttach: composer.setAttachments,
    fresh,
    ...(fresh
      ? {
          driver: draft.driver,
          onDriverChange: draft.chooseDriver,
          pendingModel: draft.model,
          envMode: draft.envMode,
          onEnvMode: draft.chooseEnvMode,
          pendingBase: draft.base,
          onBase: draft.chooseBase,
          ...(draft.driver === "claude" ? { onAdopt: submit.adoptConversation } : {}),
        }
      : {}),
    busy: Boolean(model.active),
    sending: actions.sending,
    ...(runtimeMode ? { runtimeMode: session?.runtimeMode ?? draft.runtimeMode } : {}),
    projectId: session?.projectId ?? projectId,
    ...(projectName ? { projectName } : {}),
    ...(session ? { session } : {}),
    ...(newestUsage ? { usage: newestUsage } : {}),
    backgroundTasks: model.backgroundTasks,
    settled: settling.settled,
    ...(settling.endedText === undefined ? {} : { settledEnded: settling.endedText }),
    onUnsettle: () => void settling.unsettle(),
    ...(settling.snoozedUntil === undefined ? {} : { snoozeWakeIn: wakeLabel(settling.snoozedUntil, settling.now) }),
    onWake: () => void settling.snooze(null),
    ...(builders ? { builders } : {}),
    ...(session?.driver === "claude" ? { onCompact: () => void actions.compact() } : {}),
    compacting: model.compacting,
    contextNoticePercent,
    ...(composerQuestion
      ? {
          question: composerQuestion,
          onAnswerQuestion: (requestId: string, answers: Record<string, string | string[]>) => void actions.decideRequest(requestId, "accept", { answers }),
          onCancelQuestion: (requestId: string) => void actions.decideRequest(requestId, "cancel"),
        }
      : {}),
    sentPrompts: recallablePrompts(model.transcript),
    onDraftChange: composer.changeDraft,
    onSubmit: () => void submit.submit(),
    onStop: () => void actions.stop(),
    onStopBackground: () => void actions.stopBackground(),
    // Before a session exists both choices are held locally and applied by the patch that follows creation.
    onRuntimeMode: fresh ? draft.chooseRuntimeMode : (mode) => void actions.setRuntimeMode(mode),
    onModelChange: fresh ? draft.chooseModel : (next) => void actions.setModel(next),
    ...(fresh ? {} : { onSwitchProvider: (driver: ProviderDriverKind, next: ModelChoice) => void actions.switchProvider(driver, next) }),
  };
}
