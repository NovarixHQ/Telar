"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { FolderIcon, PlusIcon } from "lucide-react";
import { Composer } from "@/features/composer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { AttachedDestination } from "./attached-destination";
import { DestinationPicker, placeOf } from "./destination-picker";
import { projectKey } from "./hosts";
import { missingPermissions, quickComposerBridge, type QuickComposerBridge, type Room } from "./front-context";
import { NeedsYouStrip } from "./needs-you-strip";
import { PermissionNotice } from "./permission-notice";
import { useQuickComposer } from "./use-quick-composer";
import { useFieldDrag, useWindowLayout } from "./use-window-layout";

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

const FLIPPED: Record<string, string> = { ArrowUp: "ArrowDown", ArrowDown: "ArrowUp" };
const PICKER_ROOM_PX = 200;
const clampTo = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function pickerPlacement(room: Room) {
  const below = room.above < PICKER_ROOM_PX && room.below > room.above;
  return { below, maxHeight: clampTo((below ? room.below : room.above) - 60, 120, 320) };
}

function onComposerKey(quick: Quick, strip: RefObject<HTMLDivElement | null>, below: boolean, event: ReactKeyboardEvent) {
  const editor = (event.target as Element).closest(EDITOR);
  if (!editor) return;
  const toStrip = event.key === "ArrowUp" && !quick.destination.picking && quick.needs.length > 0 && (quick.text === "" || caretAtStart(editor));
  const key = below && quick.destination.picking ? (FLIPPED[event.key] ?? event.key) : event.key;
  if (toStrip || quick.destination.onKey({ key, altKey: event.altKey })) {
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
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const { room, reserve } = useWindowLayout(bridge, root, composer, context);
  const fieldDrag = useFieldDrag(bridge, quick.text === "");
  const placement = pickerPlacement(room);
  const picker = quick.destination.picking && (
    <DestinationPicker rows={quick.destination.rows} index={quick.destination.index} onPick={quick.destination.pick} below={placement.below} maxHeight={placement.maxHeight} manyHosts={quick.manyHosts} />
  );
  const toComposer = () => document.querySelector<HTMLElement>(`[data-surface="quick"] ${EDITOR}`)?.focus();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void bridge?.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge]);

  return (
    <div ref={root} data-surface="quick" className="flex flex-col p-6" style={{ paddingTop: 24 + reserve }}>
      <div
        data-slot="quick-card"
        onPointerDown={fieldDrag}
        onKeyDownCapture={(event) => onComposerKey(quick, strip, placement.below, event)}
        onPointerDownCapture={quick.forgetKey}
        onClickCapture={(event) => holdForFilePicker(event, bridge)}
        className="flex flex-col gap-1"
      >
        <div className="flex flex-col gap-1">
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
          {!placement.below && picker}
          <div className="-mb-3">
            <AttachedDestination destination={quick.destination.destination} manyHosts={quick.manyHosts} nudge={quick.nudge} maxHeight={clampTo(room.above - 120, 96, 420)} onClear={quick.destination.clear} />
          </div>
        </div>
        <div ref={composer}>
          <Composer
            draft={quick.text}
            ready={projectId !== undefined}
            attachments={quick.files}
            onAttach={quick.setFiles}
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
        {placement.below && picker}
        {quick.error && <p role="alert" className="mx-4 w-fit rounded-md bg-popover px-2 py-0.5 text-xs text-destructive shadow-1">{quick.error}</p>}
      </div>
    </div>
  );
}
