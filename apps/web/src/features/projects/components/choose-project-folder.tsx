"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { Project } from "@telar/engine-client";
import { DirectoryBrowser } from "@/features/files";
import { chooseDirectory, hasNativeFolderPicker } from "@/platform/desktop/choose-directory";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
import { announceProjectsChanged } from "../projects";

const api = createEngineApi();

/** Points a project whose folder moved at where it is now. Without the desktop picker the path is typed or browsed. */
export function ChooseProjectFolder({
  project,
  onMoved,
}: {
  project: Pick<Project, "id" | "name"> & { root?: string | undefined };
  onMoved?: ((project: Project) => void) | undefined;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const relocate = async (root: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const { project: moved } = await api.relocateProject(project.id, root);
      setBrowsing(false);
      announceProjectsChanged();
      onMoved?.(moved);
    } catch (cause) {
      setError(cause instanceof EngineApiError ? cause.message : "Telar could not use that folder.");
    } finally {
      setBusy(false);
    }
  };

  const pickNatively = (from?: string) =>
    void chooseDirectory({ title: `Choose the folder for ${project.name}`, buttonLabel: "Use this folder", ...(from ? { defaultPath: from } : {}) }).then((chosen) => {
      if ("path" in chosen) void relocate(chosen.path);
      else if ("unavailable" in chosen) setBrowsing(true);
    });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => (hasNativeFolderPicker() ? pickNatively() : setBrowsing(true))}>
        {busy && <Loader2Icon className="animate-spin" />}
        Choose folder…
      </Button>
      {error && !browsing && (
        <span role="alert" className="max-w-72 text-right text-2xs text-destructive">
          {error}
        </span>
      )}
      <Dialog open={browsing} onOpenChange={(next) => !busy && setBrowsing(next)}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogTitle className="sr-only">Where is {project.name} now?</DialogTitle>
          <DialogDescription className="sr-only">Its sessions, notes and settings follow the folder you choose.</DialogDescription>
          <DirectoryBrowser
            actionLabel="Use this folder"
            {...(project.root ? { startAt: project.root } : {})}
            busy={busy}
            {...(error ? { notice: error } : {})}
            onBack={() => setBrowsing(false)}
            onSubmit={(root) => void relocate(root)}
            onPickNatively={pickNatively}
          />
        </DialogContent>
      </Dialog>
    </span>
  );
}
