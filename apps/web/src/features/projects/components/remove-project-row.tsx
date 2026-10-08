"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, XIcon } from "lucide-react";
import type { Project } from "@telar/engine-client";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import { announceProjectsChanged } from "../projects";
import { createRequestGate } from "@/platform/request-gate";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Row } from "@/features/settings";

const api = createEngineApi();

export function RemoveProjectRow({ project, onChange }: { project: Project; onChange: (project: Project) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate] = useState(createRequestGate);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    gate.retarget(project.id);
    const task = window.setTimeout(() => {
      setBusy(false);
      setOpen(false);
      setError(null);
    }, 0);
    return () => window.clearTimeout(task);
  }, [gate, project.id]);

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return;
    setOpen(next);
    if (!next) setError(null);
  };

  const run = async (action: "remove" | "restore") => {
    const target = project.id;
    const token = gate.begin(target);
    if (token === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const answer = action === "remove" ? await api.unregisterProject(target) : await api.restoreProject(target);
      if (!gate.settle(token) || !live.current) return;
      onChange(answer.project);
      announceProjectsChanged();
      setBusy(false);
      setOpen(false);
      if (action === "remove") router.push("/");
    } catch (cause) {
      if (!gate.settle(token) || !live.current) return;
      setError(cause instanceof EngineApiError ? cause.message : `Could not ${action} this project.`);
      setBusy(false);
    }
  };

  if (project.removedAt !== undefined) {
    return (
      <Row
        keywords={["undo", "restore", "removed", "unarchive"]}
        label="Restore this project"
        hint="Put away with nothing on disk touched; restoring brings back the same settings and sessions."
        info="Registering the folder again restores it too."
        {...(error ? { error } : {})}
        control={
          <div className="flex items-center gap-2">
            <Badge variant="outline">Removed</Badge>
            <Button size="sm" disabled={busy} onClick={() => void run("restore")}>
              {busy && <Loader2Icon className="animate-spin" />}
              Restore
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <Row
      keywords={["unregister", "delete", "forget", "put away"]}
      label="Remove project from Telar"
      hint="No new sessions can start on it. Files on disk are not touched, and you can put it back."
      control={
        <>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleOpenChange(true)}>
            Remove…
          </Button>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Remove {project.name} from Telar?</DialogTitle>
                <DialogDescription>
                  Telar stops offering it and no new sessions can start on it. Nothing on disk is deleted, and its sessions stay here to read.
                </DialogDescription>
              </DialogHeader>

              <p className="text-xs text-muted-foreground">
                You can put it back from this page, or by registering <span className="font-mono break-all">{project.root}</span> again — it
                returns with the same settings and sessions.
              </p>

              {error && (
                <Alert variant="destructive">
                  <XIcon />
                  <AlertTitle>Couldn&apos;t remove</AlertTitle>
                  <AlertDescription className="text-xs break-words">{error}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
                <Button type="button" variant="destructive" onClick={() => void run("remove")} disabled={busy}>
                  {busy && <Loader2Icon className="animate-spin" />}
                  Remove
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}
