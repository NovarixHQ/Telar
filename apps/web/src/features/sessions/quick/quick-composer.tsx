"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { FolderIcon, PlusIcon } from "lucide-react";
import { useSurfaceCommandKeys, type CommandId } from "@/features/commands";
import { Composer } from "@/features/composer";
import { cn } from "@/ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { AttachedDestination } from "./attached-destination";
import { DestinationPicker, placeOf } from "./destination-picker";
import { projectKey } from "./hosts";
import { missingPermissions, quickComposerBridge, type QuickComposerBridge } from "./front-context";
import { NeedsYouStrip } from "./needs-you-strip";
import { PermissionNotice } from "./permission-notice";
import { useQuickComposer } from "./use-quick-composer";
import { useWindowMode } from "./use-window-layout";

type Quick = ReturnType<typeof useQuickComposer>;

function placeholderFor(destination: Quick["destination"]["destination"]) {
  return destination?.kind === "session" ? `Reply to ${destination.session.title}` : "Ask anything · # to reply to a session or pick a project · / commands";
}

function holdForFilePicker(event: { target: EventTarget }, bridge: QuickComposerBridge | undefined) {
  if (event.target instanceof HTMLInputElement && event.target.type === "file") bridge?.hold();
}

function ProjectChip({ quick }: { quick: Quick }) {
  const choose = (next: string | null) => {
    if (!next) return;
    quick.destination.clear();
    quick.setProject(next);
  };
  return (
    <Select value={quick.project ? projectKey(quick.project) : null} onValueChange={choose}>
      <SelectTrigger size="sm" className="h-7 min-w-0 max-w-40 gap-1 rounded-full border-border/60 px-2.5 text-xs" aria-label="Project">
        <FolderIcon className="size-3.5 text-muted-foreground" />
        <SelectValue placeholder="Choose a project">{quick.project ? placeOf(quick.project, quick.manyHosts) : undefined}</SelectValue>
      </SelectTrigger>
      <SelectContent side="top" alignItemWithTrigger={false}>
        {quick.projects.map((project) => (
          <SelectItem key={projectKey(project)} value={projectKey(project)}>{placeOf(project, quick.manyHosts)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ContextOffers({ quick }: { quick: Quick }) {
  const offers = quick.offers.filter((offer) => !quick.files.includes(offer.file));
  if (offers.length === 0) return null;
  return (
    <div className="mx-6 flex flex-wrap gap-1.5">
      {offers.map((offer) => (
        <button
          key={offer.id}
          type="button"
          onClick={() => quick.toggleOffer(offer)}
          className="flex h-6 max-w-72 items-center gap-1 rounded-full border border-dashed border-border bg-popover px-2.5 text-2xs text-muted-foreground shadow-1 hover:text-foreground"
        >
          <PlusIcon className="size-3 shrink-0" />
          <span className="truncate">{offer.label}</span>
        </button>
      ))}
    </div>
  );
}

const EDITOR = '[data-slot="composer-editor"]';
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="combobox"], [role="option"], [role="listbox"], [role="toolbar"], [contenteditable="true"], [data-slot="quick-transcript"], [role="note"] p';

function focusFromEmpty(target: EventTarget) {
  if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
  document.querySelector<HTMLElement>(`[data-surface="quick"] ${EDITOR}`)?.focus();
}

function caretAtStart(editor: Element): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const before = document.createRange();
  before.selectNodeContents(editor);
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.startContainer)) return false;
  before.setEnd(caret.startContainer, caret.startOffset);
  return before.toString() === "";
}

const SURFACE_COMMANDS: readonly CommandId[] = ["toggle-dictation"];
const TRANSCRIPT_PX = 300;

function onComposerKey(quick: Quick, strip: RefObject<HTMLDivElement | null>, event: ReactKeyboardEvent) {
  const editor = (event.target as Element).closest(EDITOR);
  if (!editor) return;
  const toStrip = event.key === "ArrowUp" && !quick.destination.picking && quick.needs.length > 0 && (quick.text === "" || caretAtStart(editor));
  if (toStrip || quick.destination.onKey(event)) {
    event.preventDefault();
    event.stopPropagation();
    if (toStrip) strip.current?.querySelector("button")?.focus();
    return;
  }
  quick.noteKey(event);
}

/** A new session's composer floating over any app: Enter starts it, ⌘Enter starts it and opens Telar, Esc hides. */
export function QuickComposer({ bridge: given }: { bridge?: QuickComposerBridge }) {
  const [bridge] = useState(() => given ?? quickComposerBridge());
  const quick = useQuickComposer(bridge);
  const { draft, projectId, context } = quick;
  const strip = useRef<HTMLDivElement>(null);
  const sized = useWindowMode(bridge, quick.destination.destination?.kind === "session" || quick.destination.picking, quick.opened);
  const arriving = cn("motion-safe:transition-[opacity,translate] motion-safe:duration-[120ms] motion-safe:ease-out", sized ? "translate-y-0 opacity-100" : "invisible translate-y-2 opacity-0");
  useSurfaceCommandKeys(SURFACE_COMMANDS);
  const toComposer = () => document.querySelector<HTMLElement>(`[data-surface="quick"] ${EDITOR}`)?.focus();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void bridge?.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge]);

  return (
    <div data-surface="quick" className="flex h-screen flex-col justify-end p-6">
      <div
        data-slot="quick-card"
        onKeyDownCapture={(event) => onComposerKey(quick, strip, event)}
        onPointerDownCapture={quick.forgetKey}
        onClickCapture={(event) => holdForFilePicker(event, bridge)}
        onClick={(event) => focusFromEmpty(event.target)}
        className="flex min-h-0 flex-1 flex-col gap-1"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-y-auto">
          {bridge && context && missingPermissions(context) && <PermissionNotice bridge={bridge} context={context} />}
          <ContextOffers quick={quick} />
          <NeedsYouStrip
            items={quick.needs}
            strip={strip}
            manyHosts={quick.manyHosts}
            onPick={({ session }) => {
              quick.destination.pick({ kind: "session", session }, false);
              toComposer();
            }}
            onLeave={toComposer}
          />
          <div data-slot="quick-arriving" data-ready={sized || undefined} className={cn("-mb-1", arriving)}>
            <AttachedDestination destination={quick.destination.destination} manyHosts={quick.manyHosts} nudge={quick.nudge} height={TRANSCRIPT_PX} onClear={quick.destination.clear} />
          </div>
          </div>
          {quick.destination.picking && (
            <div data-slot="quick-arriving" data-ready={sized || undefined} className={cn("absolute inset-x-0 bottom-0 flex max-h-full flex-col justify-end", arriving)}>
              <DestinationPicker rows={quick.destination.rows} index={quick.destination.index} onPick={quick.destination.pick} manyHosts={quick.manyHosts} />
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <Composer
            draft={quick.text}
            ready={projectId !== undefined}
            attachments={quick.files}
            onAttach={quick.attach}
            fresh
            compact
            leading={<ProjectChip quick={quick} />}
            placeholder={placeholderFor(quick.destination.destination)}
            driver={draft.driver}
            onDriverChange={draft.chooseDriver}
            pendingModel={draft.model}
            envMode={draft.envMode}
            onEnvMode={draft.chooseEnvMode}
            pendingBase={draft.base}
            onBase={draft.chooseBase}
            busy={false}
            sending={quick.sending}
            runtimeMode={draft.runtimeMode}
            {...(projectId ? { projectId } : {})}
            {...(quick.project?.name ? { projectName: quick.project.name } : {})}
            backgroundTasks={0}
            onDraftChange={quick.edit}
            onSubmit={() => void quick.submit()}
            onStop={() => undefined}
            onStopBackground={() => undefined}
            onRuntimeMode={draft.chooseRuntimeMode}
            onModelChange={draft.chooseModel}
          />
        </div>
        {quick.error && <p role="alert" className="mx-4 w-fit rounded-md bg-popover px-2 py-0.5 text-xs text-destructive shadow-1">{quick.error}</p>}
      </div>
    </div>
  );
}
