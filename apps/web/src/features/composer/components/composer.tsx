"use client";

// Enter always sends; mid-turn it steers the running turn or queues behind it. Send becomes Stop only while the box is empty.

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { turnHasContent, type ProjectAvailability } from "@telar/engine-client";
import { choiceOf } from "@telar/client/providers";
import { useCommandHandlers } from "@/features/commands";
import { DictationButton, DictationGlow, useComposerDictation } from "@/features/dictation";
import { cn } from "@/ui/utils";
import { compactBlockedReason, isResumeDraft, type Completion, type ComposerPicker } from "../completions";
import { markComposerActive, takeComposerFocus, type ComposerSubmit } from "../registry";
import { hasUltrathink, toggleUltrathink } from "../model-options";
import { useHasEfforts } from "../hooks/use-composer-efforts";
import { useComposerCompletions } from "../hooks/use-composer-completions";
import { useComposerMotion } from "../hooks/use-composer-motion";
import { composerKeyHandler, useEscArm, usePromptRecall } from "../hooks/use-composer-keys";
import { useComposerRegistration } from "../hooks/use-composer-registration";
import { MAX_ATTACHMENTS, useComposerStash } from "../hooks/use-composer-stash";
import { useDropTarget } from "../hooks/use-drop-target";
import { useQuestionMode } from "../hooks/use-question-mode";
import { ComposerBanners } from "./composer-banners";
import { ComposerCard } from "./composer-card";
import type { ComposerEditorHandle } from "./composer-editor";
import { ComposerFoot, ComposerHead } from "./composer-frame";
import type { ComposerProps } from "./composer-props";
import { ComposerQuestionDrawer } from "./composer-question-drawer";
import { ContextPill } from "./context-pill";
import { QueuedMessages } from "./queued-messages";
import { ComposerPills, SendButton } from "./composer-toolbar";
import { ControlDivider } from "./control-primitives";

// External clients already reach for this id.
const EDITOR_ID = "turn-prompt";

function placeholderFor(busy: boolean, whileWorking: ComposerProps["whileWorking"]): string {
  if (busy) return whileWorking === "queue" ? "Enter queues this for after the running turn…" : "Enter sends into the running turn…";
  return "Ask anything, @ to reference, $ for skills, / for commands";
}

function blockedReason(ready: boolean, driveAway: boolean, hasContent: boolean): string | undefined {
  if (!ready) return "This session is not ready yet.";
  if (driveAway) return "The project's files are not reachable right now.";
  if (!hasContent) return "There is nothing to send.";
  return undefined;
}

/** The one gate every send passes through: Enter, ⌘↵, the send button and the page API. */
function useSubmitGate(props: ComposerProps, question: { active: boolean; advance: { current: () => boolean } }, hasContent: boolean, driveAway: boolean, startResume: () => void) {
  const { draft, ready, fresh, onAdopt, onDraftChange, onSubmit } = props;
  const advance = question.advance;
  return useCallback((): ComposerSubmit => {
    if (question.active) return advance.current() ? { ok: true } : { ok: false, reason: "The open question has no answer to send yet." };
    // `/resume` typed in full is the same press as picking it from the menu.
    if (isResumeDraft(draft) && fresh && onAdopt) {
      onDraftChange("");
      startResume();
      return { ok: true };
    }
    const reason = blockedReason(ready, driveAway, hasContent);
    if (reason) return { ok: false, reason };
    onSubmit();
    return { ok: true };
  }, [question.active, advance, ready, driveAway, draft, hasContent, onSubmit, fresh, onAdopt, onDraftChange, startResume]);
}

function runAction(action: Completion["action"], props: ComposerProps, startResume: () => void) {
  if (action.type === "env-mode") props.onEnvMode?.(action.mode);
  if (action.type === "driver") props.onDriverChange?.(action.driver);
  if (action.type === "compact") props.onCompact?.();
  if (action.type === "resume") startResume();
  if (action.type === "stop") props.onStop();
}

function useCompact(readingBack: boolean, allowed: boolean, editor: RefObject<ComposerEditorHandle | null>) {
  const [expanded, setExpanded] = useState(false);
  if (!readingBack && expanded) setExpanded(false);
  const expand = () => {
    setExpanded(true);
    editor.current?.focus();
  };
  return [readingBack && allowed && !expanded, expand] as const;
}

function ComposerContext({ usage, session, onCompact, busy, sending, compacting }: ComposerProps) {
  return (
    <ContextPill
      {...(usage ? { usage } : {})}
      {...(session ? { driver: session.driver } : {})}
      {...(onCompact ? { onCompact } : {})}
      compactDisabled={busy || sending || Boolean(compacting)}
      compactReason={compactBlockedReason({ busy, ...(compacting ? { compacting } : {}) }) ?? "Sending…"}
    />
  );
}

export function Composer(props: ComposerProps) {
  const { draft, ready, readingBack = false, kind = "session", attachments, onAttach, fresh = false, driver, busy, sending, session, projectId, onDraftChange, onStop } = props;
  const editor = useRef<ComposerEditorHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  // Reported up by the environment strip, which already polls the project's git state.
  const [driveAway, setDriveAway] = useState<Exclude<ProjectAvailability, "available">>();
  const [resuming, setResuming] = useState(false);
  const startResume = useCallback(() => setResuming(true), []);
  const [summon, setSummon] = useState<{ picker: ComposerPicker; at: number }>();
  const token = useId();
  const activeDriver = session?.driver ?? driver ?? "claude";
  const choice = choiceOf(session?.model ?? props.pendingModel);

  const question = useQuestionMode(props.question, props.onAnswerQuestion, draft);
  const hasContent = turnHasContent(draft, attachments.map((file) => file.type));
  const trySubmit = useSubmitGate(props, question, hasContent, Boolean(driveAway), startResume);
  useComposerRegistration(token, EDITOR_ID, kind, editor, { text: question.boxText, ready, submit: trySubmit });
  const dictation = useComposerDictation(token);
  const esc = useEscArm(busy, onStop);
  const stash = useComposerStash({ draft, attachments, projectId, sessionId: session?.id, onDraftChange, onAttach, editor });
  const hasEfforts = useHasEfforts(activeDriver, choice, session?.providerInstanceId);
  const pillsShown = Boolean(session || (fresh && driver));
  const menu = useComposerCompletions({
    editor,
    sessionId: session?.id,
    projectId,
    menuDriver: fresh ? driver : session?.driver,
    blocked: question.active,
    commands: { busy, fresh, pickers: { model: pillsShown, effort: pillsShown && hasEfforts, access: pillsShown && Boolean(props.runtimeMode) }, envMode: props.envMode, compacting: props.compacting, canResume: Boolean(props.onAdopt) },
  });
  const pick = (completion: Completion) => {
    const action = menu.take(completion);
    if (action?.type === "picker") setSummon((last) => ({ picker: action.picker, at: (last?.at ?? 0) + 1 }));
    else if (action && action.type !== "insert") runAction(action, props, startResume);
  };
  const recall = usePromptRecall(props.sentPrompts, session?.id ?? `fresh:${projectId}`, draft, onDraftChange);
  const onKeyDown = composerKeyHandler({ draft, attachments, busy, questionActive: question.active, stash, menu, pick, submit: () => void trySubmit(), recall, esc });
  useCommandHandlers({ "focus-composer": () => editor.current?.focus(), send: () => void trySubmit(), "stop-turn": () => busy && onStop() });
  useEffect(() => {
    if (takeComposerFocus(session?.id)) editor.current?.focus();
  }, [session?.id]);

  const addFiles = (files: File[]) => onAttach([...attachments, ...files].slice(0, MAX_ATTACHMENTS));
  const drop = useDropTarget(editor, addFiles);
  const [compactNow, expand] = useCompact(readingBack, !fresh && !question.active && !drop.dropping && !stash.open && !esc.armed && !driveAway && attachments.length === 0, editor);
  const shape = [compactNow, attachments.length > 0, question.active, Boolean(driveAway)].join();
  const motion = useComposerMotion(box, shape, session?.id ?? `fresh:${projectId}`);
  const pills = (
    <>
      {props.leading && <>{props.leading}{pillsShown && <ControlDivider />}</>}
      {pillsShown && (
        <ComposerPills {...props} summon={summon} driver={activeDriver} choice={choice} instanceId={session?.providerInstanceId}
          ultrathink={{ active: hasUltrathink(draft), toggle: () => onDraftChange(toggleUltrathink(draft)) }} />
      )}
    </>
  );
  const send = (
    <SendButton
      busy={busy}
      sending={sending}
      hasContent={hasContent}
      escArmed={esc.armed}
      blocked={blockedReason(ready, Boolean(driveAway), true)}
      onStop={onStop}
      animate={motion}
      {...(question.active ? { question: { label: question.submitLabel, ready: question.canAdvance } } : {})}
    />
  );

  const onEdit = (text: string) => {
    if (question.typeAnswer(text)) return;
    onDraftChange(text);
    // Before the state round-trip: the caret is read from the live DOM of this same edit.
    menu.edited(text);
    stash.setOpen(false);
    stash.setNote(undefined);
  };

  return (
    <div className="relative z-20 w-full shrink-0 px-4">
      <div
        className={cn(
          "@container/composer relative mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-1.5 pt-2",
          "transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
          props.compact ? "pb-1" : "pb-5",
          fresh && !props.compact && "-translate-y-[calc(45dvh-7.5rem)]",
        )}
      >
        <ComposerHead props={props} resuming={resuming} onResuming={setResuming} note={stash.note} onDismissNote={() => stash.setNote(undefined)} />
        <div ref={box}>
          {props.queued && <QueuedMessages {...props.queued} />}
          <ComposerBanners {...props} />
          {question.active && props.question && (
            <ComposerQuestionDrawer
              fields={question.fields}
              draft={question.answer}
              onDraft={question.setAnswer}
              sending={sending}
              onCancelTurn={() => props.question && props.onCancelQuestion?.(props.question.id)}
            />
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              trySubmit();
            }}
          >
            <DictationGlow phase={dictation.phase} stream={dictation.stream}>
              <ComposerCard
                editor={editor}
                editorId={EDITOR_ID}
                kind={kind}
                text={question.boxText}
                placeholder={question.active ? "Type your own answer, or leave blank…" : (props.placeholder ?? placeholderFor(busy, props.whileWorking))}
                ready={ready}
                compact={compactNow}
                draft={draft}
                attachments={attachments}
                onAttach={onAttach}
                addFiles={addFiles}
                onDraftChange={onDraftChange}
                onEdit={onEdit}
                onSelectionChange={() => !question.active && menu.retrigger(draft)}
                onKeyDown={onKeyDown}
                onFocus={() => {
                  markComposerActive(token);
                  menu.prime();
                }}
                onExpand={expand}
                stash={stash}
                menu={menu}
                pick={pick}
                drop={drop}
                pills={pills}
                trailing={
                  <>
                    {!compactNow && <ComposerContext {...props} />}
                    <DictationButton dictation={dictation} />
                    {send}
                  </>
                }
              />
            </DictationGlow>
          </form>
          <ComposerFoot props={props} tray={compactNow} pills={pillsShown || props.leading ? pills : null} hidden={dictation.phase !== "idle"} onAvailability={setDriveAway} />
        </div>
      </div>
    </div>
  );
}
