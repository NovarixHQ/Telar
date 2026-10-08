"use client";

import { createContext, useContext, useMemo, type ComponentProps } from "react";
import type { FileReference } from "@telar/engine-client";
import { MessageResponse } from "@/ui/message";
import { cn } from "@/ui/utils";
import { useFileReferences } from "../file-references";
import { FileReferenceChip } from "./prompt-text";

type Files = { files: ReadonlyMap<string, FileReference>; onOpen?: ((path: string) => void) | undefined };

const MessageFiles = createContext<Files | undefined>(undefined);

function InlineCode({ className, children, ...props }: ComponentProps<"code"> & { node?: unknown }) {
  const attributes = { ...props };
  delete attributes.node;
  const context = useContext(MessageFiles);
  const reference = typeof children === "string" ? context?.files.get(children.trim()) : undefined;
  if (reference) return <FileReferenceChip reference={reference} onOpen={context?.onOpen} />;
  return (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)} data-streamdown="inline-code" {...attributes}>
      {children}
    </code>
  );
}

const COMPONENTS = { inlineCode: InlineCode };

/** A finished agent message, with inline code that names a file in the checkout drawn as a chip. */
export function AgentMarkdown({ text, onOpenFile }: { text: string; onOpenFile?: ((path: string) => void) | undefined }) {
  const files = useFileReferences(text);
  const value = useMemo(() => ({ files, onOpen: onOpenFile }), [files, onOpenFile]);
  return (
    <MessageFiles.Provider value={value}>
      <MessageResponse components={COMPONENTS}>{text}</MessageResponse>
    </MessageFiles.Provider>
  );
}
