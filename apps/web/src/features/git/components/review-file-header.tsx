"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, InfoIcon, RotateCwIcon } from "lucide-react";
import type { GitFileChange } from "@telar/engine-client";
import { REVIEW_STATUS_LETTER, REVIEW_STATUS_WORD } from "../session-review";
import { Badge } from "@/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/ui/utils";

const COPIED_MS = 1_500;

function HeaderButton({ label, tip, onClick, children, ...rest }: { label: string; tip: string; onClick: () => void; children: ReactNode; "aria-expanded"?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            {...rest}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {children}
          </button>
        }
      />
      <TooltipContent side="top" className="max-w-72 text-xs leading-snug">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard
      ?.writeText(path)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => {});
  return (
    <HeaderButton label="Copy file path" tip={copied ? "Copied" : "Copy path"} onClick={copy}>
      {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
    </HeaderButton>
  );
}

export type FileHeaderStatus = { kind: "failed"; onRetry: () => void } | { kind: "partial"; note: string };

/** One file's header: the chevron folds the patch, the name opens the file (or folds when nothing can open it). */
export function ReviewFileHeader({
  file,
  reported,
  edits,
  registration,
  open,
  status,
  onToggle,
  onOpenFile,
}: {
  file: GitFileChange;
  reported: boolean;
  edits: number | undefined;
  registration: true | undefined;
  open: boolean;
  status: FileHeaderStatus | undefined;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const cut = file.path.lastIndexOf("/");
  return (
    <div className={cn("flex w-full min-w-0 items-center gap-1.5 py-1.5 pr-2 pl-2 text-xs", open && "border-b border-border/60")}>
      <HeaderButton label={open ? `Collapse ${file.path}` : `Expand ${file.path}`} tip={open ? "Collapse diff" : "Expand diff"} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
      </HeaderButton>
      <span className="w-3 shrink-0 font-mono text-3xs text-muted-foreground" title={REVIEW_STATUS_WORD[file.status]}>
        {REVIEW_STATUS_LETTER[file.status]}
      </span>
      <button
        type="button"
        onClick={() => (onOpenFile ? onOpenFile(file.path) : onToggle())}
        title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}
        className="min-w-0 truncate rounded text-left font-mono text-2xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cut > -1 && <span className="text-muted-foreground">{file.path.slice(0, cut + 1)}</span>}
        <span className="text-foreground">{file.path.slice(cut + 1)}</span>
      </button>
      <CopyPathButton path={file.path} />
      <span className="flex-1" />
      {!reported && !registration && (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-4xs font-normal text-warning">
          unreported
        </Badge>
      )}
      {registration && (
        <Badge
          variant="outline"
          className="shrink-0 px-1 py-0 text-4xs font-normal"
          title="Telar’s own ignore rules — telar.yaml and .telar/ — added when this project was registered, not by this session"
        >
          setup
        </Badge>
      )}
      {edits !== undefined && (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-4xs font-normal" title={`The session wrote this ${edits} times`}>
          ×{edits}
        </Badge>
      )}
      {file.binary && (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-4xs font-normal">
          bin
        </Badge>
      )}
      <span className="shrink-0 font-mono text-3xs tabular-nums">
        {file.linesAdded ? <span className="text-success">+{file.linesAdded}</span> : null}
        {file.linesAdded && file.linesRemoved ? " " : null}
        {file.linesRemoved ? <span className="text-destructive">−{file.linesRemoved}</span> : null}
      </span>
      {status?.kind === "failed" && (
        <HeaderButton label="Retry loading diff" tip="Retry loading diff" onClick={status.onRetry}>
          <RotateCwIcon className="size-3" />
        </HeaderButton>
      )}
      {status?.kind === "partial" && (
        <HeaderButton label={status.note} tip={status.note} onClick={() => {}}>
          <InfoIcon className="size-3" />
        </HeaderButton>
      )}
    </div>
  );
}
