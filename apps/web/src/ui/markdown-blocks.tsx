"use client";

import { isValidElement, useState, type ComponentProps } from "react";
import { WrapTextIcon } from "lucide-react";
import { CodeBlock, CodeBlockCopyButton, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import { cn } from "@/ui/utils";

const LANGUAGE = /language-([^\s]+)/;
const START_LINE = /startLine=(\d+)/;
const NO_LINE_NUMBERS = /\bnoLineNumbers\b/;

function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (isValidElement<{ children?: unknown }>(children) && typeof children.props.children === "string") return children.props.children;
  return "";
}

export function MarkdownCode({ node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  const isIncomplete = useIsCodeFenceIncomplete();
  const [wrapped, setWrapped] = useState(false);
  if (!("data-block" in props)) {
    return (
      <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)} data-streamdown="inline-code" {...props}>
        {children}
      </code>
    );
  }
  const meta = typeof node?.properties?.metastring === "string" ? node.properties.metastring : "";
  const startLine = Number(START_LINE.exec(meta)?.[1]);
  const label = wrapped ? "Don't wrap lines" : "Wrap lines";
  return (
    <CodeBlock
      code={codeText(children)}
      language={className?.match(LANGUAGE)?.[1] ?? ""}
      isIncomplete={isIncomplete}
      lineNumbers={!NO_LINE_NUMBERS.test(meta)}
      {...(startLine >= 1 ? { startLine } : {})}
      className={cn(className, wrapped && "whitespace-pre-wrap wrap-anywhere")}
    >
      <button
        type="button"
        aria-pressed={wrapped}
        aria-label={label}
        title={label}
        className={cn("cursor-pointer p-1 transition-colors hover:text-foreground", wrapped ? "text-foreground" : "text-muted-foreground")}
        onClick={() => setWrapped((current) => !current)}
      >
        <WrapTextIcon size={14} />
      </button>
      <CodeBlockCopyButton />
    </CodeBlock>
  );
}
