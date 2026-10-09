"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, FolderIcon, ShieldAlertIcon } from "lucide-react";
import { Composer } from "@/features/composer";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { missingPermissions, quickComposerBridge, type FrontContext, type Permission, type QuickComposerBridge } from "./front-context";
import { useQuickComposer } from "./use-quick-composer";

const SKIPPED_KEY = "telar.quick-composer.permissions-skipped";

const PERMISSIONS: readonly { key: Permission; label: string; use: string; info?: string }[] = [
  { key: "screen", label: "Screen Recording", use: "attaches the window in front", info: "macOS may apply it only after a restart." },
  { key: "accessibility", label: "Accessibility", use: "attaches your selected text" },
];

function PermissionNotice({ bridge, context }: { bridge: QuickComposerBridge; context: FrontContext }) {
  const [skipped, setSkipped] = useState(() => window.localStorage.getItem(SKIPPED_KEY) === "1");
  if (skipped) return null;
  const skip = () => {
    window.localStorage.setItem(SKIPPED_KEY, "1");
    setSkipped(true);
  };
  return (
    <div role="note" className="mx-4 flex flex-col gap-1 rounded-xl border border-border/80 bg-card/95 p-2 pl-3 text-xs shadow-2 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <ShieldAlertIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate">Allow “{context.grantee}” to attach what you’re looking at. The composer works without it.</p>
        <Button size="xs" variant="ghost" onClick={skip}>Skip</Button>
      </div>
      <ul className="flex flex-col">
        {PERMISSIONS.map(({ key, label, use, info }) => (
          <li key={key} data-permission={key} className="flex h-7 items-center gap-2 pl-6">
            <span className="font-medium" {...(info ? { title: info } : {})}>{label}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{use}</span>
            {context.permissions[key] ? (
              <span className="flex items-center gap-1 pr-2 text-muted-foreground">
                Granted <CheckIcon className="size-3.5" />
              </span>
            ) : (
              <Button size="xs" variant="outline" onClick={() => void bridge.openSettings(key)}>Open Settings</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
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

function ProjectChip({ quick }: { quick: ReturnType<typeof useQuickComposer> }) {
  return (
    <Select value={quick.projectId ?? null} onValueChange={(next) => next && quick.setProjectId(next)}>
      <SelectTrigger size="sm" className="h-7 shrink-0 gap-1 rounded-full border-border/60 px-2.5 text-xs" aria-label="Project">
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

/** A new session's composer floating over any app: Enter starts it, ⌘Enter starts it and opens Telar, Esc hides. */
export function QuickComposer({ bridge = quickComposerBridge() }: { bridge?: QuickComposerBridge }) {
  const quick = useQuickComposer(bridge);
  const { draft, projectId, context } = quick;
  const root = useReportHeight(bridge);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void bridge?.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge]);

  return (
    <div ref={root} data-surface="quick" className="flex flex-col gap-1 pt-2 pb-3">
      {bridge && context && missingPermissions(context) && <PermissionNotice bridge={bridge} context={context} />}
      <div onKeyDownCapture={quick.noteKey} onPointerDownCapture={quick.forgetKey}>
        <Composer
          draft={quick.text}
          ready={projectId !== undefined}
          attachments={quick.files}
          onAttach={quick.setFiles}
          fresh
          compact
          leading={<ProjectChip quick={quick} />}
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
      {quick.error && <p role="alert" className="mx-4 w-fit rounded-md bg-card/95 px-2 py-0.5 text-xs text-destructive shadow-1">{quick.error}</p>}
      <footer data-slot="quick-hint" className="mx-auto w-fit rounded-full bg-card/80 px-2.5 py-0.5 text-2xs text-muted-foreground shadow-1 backdrop-blur-xl">
        ↵ send · ⌘↵ send &amp; open · esc close
      </footer>
    </div>
  );
}
