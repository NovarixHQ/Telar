"use client";

import { Fragment, type ReactNode } from "react";
import type { FileReference } from "@telar/engine-client";
import { CHIP_CLASS, CHIP_ICON_CLASS, CHIP_LABEL_CLASS, chipIsDirectory, chipPath, chipTitle, segmentDraft } from "@/features/composer";
import { chipGlyphFor, type TelarReference } from "@/features/composer";
import { FileKindIcon, revealLine } from "@/features/files";
import { cn } from "@/ui/utils";
import { filePanelTab, issuePanelTab, pullPanelTab, type PanelTab } from "@/features/panel";
import { useFileReferences } from "../file-references";

function ChipGlyph({ markup, className }: { markup: string; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function panelTabFor(reference: TelarReference): PanelTab | undefined {
  if (reference.kind === "issue") {
    const number = /^#(\d+) /.exec(reference.text);
    return number ? issuePanelTab(Number(number[1])) : undefined;
  }
  if (reference.kind === "pull") {
    const number = /^PR #(\d+) /.exec(reference.text);
    return number ? pullPanelTab(Number(number[1])) : undefined;
  }
  if (reference.kind === "file" && !chipIsDirectory(reference)) return filePanelTab(chipPath(reference));
  return undefined;
}

function Chip({ title, onClick, children }: { title: string; onClick?: (() => void) | undefined; children: ReactNode }) {
  if (!onClick) {
    return (
      <span className={CHIP_CLASS} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`Open — ${title}`}
      className={cn(CHIP_CLASS, "cursor-pointer transition-colors hover:border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ReferenceChip({ reference, onOpen }: { reference: TelarReference; onOpen?: (tab: PanelTab) => void }) {
  const { markup, tint } = chipGlyphFor(reference);
  const tab = onOpen ? panelTabFor(reference) : undefined;
  return (
    <Chip title={chipTitle(reference)} onClick={tab ? () => onOpen?.(tab) : undefined}>
      <ChipGlyph markup={markup} className={cn(CHIP_ICON_CLASS, tint)} />
      <span className={CHIP_LABEL_CLASS}>{reference.label}</span>
    </Chip>
  );
}

export function FileReferenceChip({ reference, onOpen }: { reference: FileReference; onOpen?: ((path: string) => void) | undefined }) {
  const name = reference.path.slice(reference.path.lastIndexOf("/") + 1);
  const open = () => {
    if (reference.line) revealLine(reference.path, reference.line);
    onOpen?.(reference.path);
  };
  return (
    <Chip title={reference.line ? `${reference.path}:${reference.line}` : reference.path} onClick={onOpen ? open : undefined}>
      <FileKindIcon path={reference.path} className={CHIP_ICON_CLASS} />
      <span className={CHIP_LABEL_CLASS}>{reference.line ? `${name} · L${reference.line}` : name}</span>
    </Chip>
  );
}

const CODE_SPAN = /(`[^`\n]+`)/;

function TypedText({ text, files, onOpen }: { text: string; files: ReadonlyMap<string, FileReference>; onOpen?: ((path: string) => void) | undefined }) {
  if (!files.size) return <>{text}</>;
  return (
    <>
      {text.split(CODE_SPAN).map((part, index) => {
        const reference = index % 2 ? files.get(part.slice(1, -1).trim()) : undefined;
        return reference ? <FileReferenceChip key={index} reference={reference} onOpen={onOpen} /> : <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

export function PromptText({
  text,
  className,
  onOpen,
}: {
  text: string;
  className?: string;
  onOpen?: (tab: PanelTab) => void;
}) {
  const files = useFileReferences(text);
  const openFile = onOpen ? (path: string) => onOpen(filePanelTab(path)) : undefined;
  return (
    <p className={cn("whitespace-pre-wrap", className)}>
      {segmentDraft(text).map((segment, index) =>
        segment.type === "chip" ? (
          <ReferenceChip key={index} reference={segment.reference} {...(onOpen ? { onOpen } : {})} />
        ) : (
          <TypedText key={index} text={segment.text} files={files} onOpen={openFile} />
        ),
      )}
    </p>
  );
}
