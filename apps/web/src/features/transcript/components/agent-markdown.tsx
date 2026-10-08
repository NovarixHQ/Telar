"use client";

import { createContext, useContext, useMemo, type ComponentProps } from "react";
import type { FileReference } from "@telar/engine-client";
import { InlineCode } from "@/ui/markdown-blocks";
import { MessageResponse } from "@/ui/message";
import { useFileReferences } from "../file-references";
import { FileReferenceChip } from "./prompt-text";

type Files = { files: ReadonlyMap<string, FileReference>; onOpen?: ((path: string) => void) | undefined };

const MessageFiles = createContext<Files | undefined>(undefined);

function FileAwareCode({ children, ...props }: ComponentProps<"code"> & { node?: unknown }) {
  const attributes = { ...props };
  delete attributes.node;
  const context = useContext(MessageFiles);
  const reference = typeof children === "string" ? context?.files.get(children.trim()) : undefined;
  if (reference) return <FileReferenceChip reference={reference} onOpen={context?.onOpen} />;
  return <InlineCode {...attributes}>{children}</InlineCode>;
}

const COMPONENTS = { inlineCode: FileAwareCode };

export function AgentMarkdown({ text, onOpenFile }: { text: string; onOpenFile?: ((path: string) => void) | undefined }) {
  const files = useFileReferences(text);
  const value = useMemo(() => ({ files, onOpen: onOpenFile }), [files, onOpenFile]);
  return (
    <MessageFiles.Provider value={value}>
      <MessageResponse components={COMPONENTS}>{text}</MessageResponse>
    </MessageFiles.Provider>
  );
}
