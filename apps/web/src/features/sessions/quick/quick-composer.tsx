"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FolderIcon, PlusIcon } from "lucide-react";
import { Composer } from "@/features/composer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { AttachedDestination } from "./attached-destination";
import { DestinationPicker } from "./destination-picker";
import { missingPermissions, quickComposerBridge, type QuickComposerBridge } from "./front-context";
import { PermissionNotice } from "./permission-notice";
import { useQuickComposer } from "./use-quick-composer";
import { useWindowDrag } from "./use-window-drag";

type Quick = ReturnType<typeof useQuickComposer>;

function placeholderFor(destination: Quick["destination"]["destination"]) {
  return destination?.kind === "session" ? `Reply to ${destination.session.title}` : "Ask anything · # to reply to a session or pick a project · / commands";
}

function holdForFilePicker(event: { target: EventTarget }, bridge: QuickComposerBridge | undefined) {
  if (event.target instanceof HTMLInputElement && event.target.type === "file") bridge?.hold();
}

function useReportHeight(bridge: QuickComposerBridge | undefined) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!bridge || !node) return;
    const observer = new ResizeObserver(() => bridge.resize(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [bridge]);
  return root;
}

function ProjectChip({ quick }: { quick: Quick }) {
  const choose = (next: string | null) => {
    if (!next) return;
    quick.destination.clear();
    quick.setProjectId(next);
  };
  return (
    <Select value={quick.projectId ?? null} onValueChange={choose}>
      <SelectTrigger size="sm" className="h-7 min-w-0 max-w-40 gap-1 rounded-full border-border/60 px-2.5 text-xs" aria-label="Project">
        <FolderIcon className="size-3.5 text-muted-foreground" />
        <SelectValue placeholder="Choose a project">{quick.project?.name ?? quick.projectId}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {quick.projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>{project.name ?? project.id}</SelectItem>
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
          {offer.id === "window" && <kbd className="font-mono opacity-70">⌘⇧A</kbd>}
        </button>
      ))}
    </div>
  );
}

function onComposerKey(quick: Quick, event: ReactKeyboardEvent) {
  const windowOffer = quick.offers.find((offer) => offer.id === "window");
  const shortcut = event.metaKey && event.shiftKey && event.key.toLowerCase() === "a";
  if ((shortcut && windowOffer) || quick.destination.onKey(event)) {
    event.preventDefault();
    event.stopPropagation();
    if (shortcut && windowOffer) quick.toggleOffer(windowOffer);
    return;
  }
  quick.noteKey(event);
}

/** A new session's composer floating over any app: Enter starts it, ⌘Enter starts it and opens Telar, Esc hides. */
export function QuickComposer({ bridge = quickComposerBridge() }: { bridge?: QuickComposerBridge }) {
  const quick = useQuickComposer(bridge);
  const { draft, projectId, context } = quick;
  const root = useReportHeight(bridge);
  const startDrag = useWindowDrag(bridge);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void bridge?.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge]);

  return (
    <div ref={root} data-surface="quick" onPointerDown={startDrag} className="flex flex-col gap-1 pt-2 pb-3">
      {bridge && context && missingPermissions(context) && <PermissionNotice bridge={bridge} context={context} />}
      <ContextOffers quick={quick} />
      <div onKeyDownCapture={(event) => onComposerKey(quick, event)} onPointerDownCapture={quick.forgetKey} onClickCapture={(event) => holdForFilePicker(event, bridge)}>
        <div className="-mb-2 pt-1">
          <AttachedDestination destination={quick.destination.destination} onClear={quick.destination.clear} />
        </div>
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
          onDraftChange={quick.setText}
          onSubmit={() => void quick.submit()}
          onStop={() => undefined}
          onStopBackground={() => undefined}
          onRuntimeMode={draft.chooseRuntimeMode}
          onModelChange={draft.chooseModel}
        />
      </div>
      {quick.destination.picking && <DestinationPicker rows={quick.destination.rows} index={quick.destination.index} onPick={quick.destination.pick} />}
      {quick.error && <p role="alert" className="mx-4 w-fit rounded-md bg-popover px-2 py-0.5 text-xs text-destructive shadow-1">{quick.error}</p>}
      <footer data-slot="quick-hint" className="mx-auto w-fit rounded-full bg-popover px-2.5 py-0.5 text-2xs text-muted-foreground shadow-1">
        ↵ send · ⌘↵ send &amp; open · # destination · esc close
      </footer>
    </div>
  );
}
