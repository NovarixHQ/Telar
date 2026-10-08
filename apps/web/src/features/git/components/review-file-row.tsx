"use client";

import { useEffect, useState } from "react";
import type { GitFileChange, GitFilePatch } from "@telar/engine-client";
import { fileReference, startReferenceDrag } from "@/features/composer";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/ui/context-menu";
import { PanelRow } from "@/ui/panel";
import { Spinner } from "@/ui/spinner";
import type { DiffView } from "../hooks/use-diff-view";
import { INCOMPLETE_PATCH, type PatchWitness } from "../model";
import { PatchBody } from "./patch-body";
import { ReviewFileHeader, type FileHeaderStatus } from "./review-file-header";
import type { PullCommentContext } from "./pull-line-comment";

type RowActions = {
  onOpenFile?: (path: string) => void;
  onOpenInNewPanelTab?: (path: string) => void;
  onInsertReference?: (text: string) => void;
};

/** One changed file. Its patch is read when opened, with the whole row so a rename is read with both paths. */
export function ReviewFileRow({
  readPatch,
  file,
  reported,
  edits,
  registration,
  view,
  open,
  witness = "git",
  onToggle,
  onOpenFile,
  onOpenInNewPanelTab,
  onInsertReference,
  pullComment,
}: RowActions & {
  readPatch: (file: GitFileChange) => Promise<{ file: GitFilePatch }>;
  witness?: PatchWitness;
  file: GitFileChange;
  reported: boolean;
  view: DiffView;
  open: boolean;
  onToggle: () => void;
  edits?: number;
  registration?: true;
  pullComment?: PullCommentContext;
}) {
  // Stamped with its reader: a new reader (whitespace flag, base) discards the answer in the same render.
  const [answer, setAnswer] = useState<{ reader: typeof readPatch; patch?: GitFilePatch; failed: boolean }>({ reader: readPatch, failed: false });
  const current = answer.reader === readPatch ? answer : { reader: readPatch, failed: false };
  if (current !== answer) setAnswer(current);
  const { patch, failed } = current;

  useEffect(() => {
    if (!open || patch !== undefined || failed) return;
    let cancelled = false;
    void readPatch(file)
      .then((result) => {
        if (!cancelled) setAnswer({ reader: readPatch, patch: result.file, failed: false });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ reader: readPatch, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // The row object is rebuilt on every poll with the same fields; depending on it would re-read an open patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patch, failed, readPatch, file.path, file.status, file.renamedFrom]);

  const actions = { ...(onInsertReference ? { onInsertReference } : {}), ...(pullComment ? { pullComment } : {}) };
  const retry = () => setAnswer({ reader: readPatch, failed: false });
  const status: FileHeaderStatus | undefined =
    failed || patch?.incomplete === "timeout" || patch?.incomplete === "failed"
      ? { kind: "failed", onRetry: retry }
      : patch?.incomplete === "truncated"
        ? { kind: "partial", note: INCOMPLETE_PATCH.truncated[witness] }
        : undefined;
  return (
    <div data-diff-path={file.path} draggable onDragStart={(event) => startReferenceDrag(event.dataTransfer, fileReference(file.path))}>
      <ContextMenu>
        <ContextMenuTrigger>
          <PanelRow className="p-0 pl-0">
            <ReviewFileHeader
              file={file}
              reported={reported}
              edits={edits}
              registration={registration}
              open={open}
              status={status}
              onToggle={onToggle}
              {...(onOpenFile ? { onOpenFile } : {})}
            />
          </PanelRow>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-auto">
          {onOpenFile && <ContextMenuItem onClick={() => onOpenFile(file.path)}>Open in Editor</ContextMenuItem>}
          {onOpenInNewPanelTab && <ContextMenuItem onClick={() => onOpenInNewPanelTab(file.path)}>Open in a new panel tab</ContextMenuItem>}
          {(onOpenFile || onOpenInNewPanelTab) && <ContextMenuSeparator />}
          <ContextMenuItem onClick={() => void navigator.clipboard.writeText(file.path)}>Copy path</ContextMenuItem>
          {onInsertReference && <ContextMenuItem onClick={() => onInsertReference(fileReference(file.path).text)}>Insert as reference</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onToggle}>{open ? "Collapse patch" : "Expand patch"}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open &&
        (failed ? (
          <p className="px-4 py-2 text-2xs text-muted-foreground">
            {witness === "git" ? "git could not produce a patch for this path." : "This turn's patch for the file could not be read."}
          </p>
        ) : patch === undefined ? (
          <p className="flex items-center gap-2 px-4 py-2 text-2xs text-muted-foreground">
            <Spinner className="size-3" /> reading the diff…
          </p>
        ) : patch.incomplete && patch.patch === "" ? (
          <p className="px-4 py-2 text-2xs text-warning">{INCOMPLETE_PATCH[patch.incomplete][witness]}</p>
        ) : patch.binary ? (
          <p className="px-4 py-2 text-2xs text-muted-foreground">Binary file — no textual diff.</p>
        ) : patch.patch === "" ? (
          <p className="px-4 py-2 text-2xs text-muted-foreground">No textual difference.</p>
        ) : (
          <PatchBody patch={patch.patch} view={view} path={file.path} {...actions} />
        ))}
      {file.renamedFrom && <p className="px-4 pb-2 pl-[1.9rem] text-2xs text-muted-foreground">Renamed from {file.renamedFrom}</p>}
    </div>
  );
}
