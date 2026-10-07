"use client";

import { useEffect, useRef, useState } from "react";
import { Composer } from "@/features/composer";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { missingPermissions, quickComposerBridge, type QuickComposerBridge } from "./front-context";
import { useQuickComposer } from "./use-quick-composer";

const SKIPPED_KEY = "telar.quick-composer.permissions-skipped";

function PermissionNotice({ bridge }: { bridge: QuickComposerBridge }) {
  const [skipped, setSkipped] = useState(() => window.localStorage.getItem(SKIPPED_KEY) === "1");
  if (skipped) return null;
  const skip = () => {
    window.localStorage.setItem(SKIPPED_KEY, "1");
    setSkipped(true);
  };
  return (
    <div role="note" className="mx-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">Telar needs two permissions</p>
      <p className="text-muted-foreground">To attach the window in front and your selected text. You can skip this; the composer still works.</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => void bridge.openSettings()}>Open System Settings</Button>
        <Button size="sm" variant="ghost" onClick={skip}>Skip</Button>
      </div>
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

/** A new session's composer in a small window over any app: Enter starts it, ⌘Enter starts it and opens Telar, Esc hides. */
export function QuickComposer({ bridge = quickComposerBridge() }: { bridge?: QuickComposerBridge }) {
  const quick = useQuickComposer(bridge);
  const { draft, projectId } = quick;
  const root = useReportHeight(bridge);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void bridge?.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge]);

  return (
    <div ref={root} className="flex flex-col gap-2 py-2">
      <header className="flex items-center gap-2 px-4 text-xs text-muted-foreground">
        <span>New session in</span>
        <Select value={projectId ?? null} onValueChange={(next) => next && quick.setProjectId(next)}>
          <SelectTrigger size="sm" className="h-7" aria-label="Project">
            <SelectValue placeholder="Choose a project">{quick.project?.name ?? projectId}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {quick.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>{project.name ?? project.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <kbd className="ml-auto font-mono">esc</kbd>
      </header>
      {bridge && missingPermissions(quick.context) && <PermissionNotice bridge={bridge} />}
      <div onKeyDownCapture={quick.noteKey} onPointerDownCapture={quick.forgetKey}>
        <Composer
          draft={quick.text}
          ready={projectId !== undefined}
          attachments={quick.files}
          onAttach={quick.setFiles}
          fresh
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
      {quick.error && <p role="alert" className="px-4 text-xs text-destructive">{quick.error}</p>}
      <footer className="px-4 text-xs text-muted-foreground">↵ send · ⌘↵ send &amp; open</footer>
    </div>
  );
}
