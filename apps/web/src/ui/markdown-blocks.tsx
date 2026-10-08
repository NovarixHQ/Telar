"use client";

import { isValidElement, Suspense, useState, type ComponentProps, type KeyboardEvent, type MouseEvent } from "react";
import { WrapTextIcon } from "lucide-react";
import { CodeBlock, CodeBlockCopyButton, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import dynamic from "next/dynamic";
import { cn } from "@/ui/utils";

const ImageLightbox = dynamic(() => import("@/ui/image-lightbox").then((mod) => mod.ImageLightbox));

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

/** A span, not a button: Streamdown draws links as buttons, and a linked image would nest one in the other. */
export function MarkdownImage({ src, alt, title }: ComponentProps<"img"> & ExtraProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (typeof src !== "string" || !src) return null;
  if (failed) return <span className="text-xs text-muted-foreground italic">Image not available</span>;
  const expand = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label={alt ? `Open image: ${alt}` : "Open image"}
        className="my-2 inline-block max-w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={expand}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") expand(event);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary sources from agent replies */}
        <img src={src} alt={alt ?? ""} {...(title ? { title } : {})} loading="lazy" onError={() => setFailed(true)} className="block max-w-full rounded-lg" />
      </span>
      {open && (
        <Suspense fallback={null}>
          <ImageLightbox src={src} alt={alt || "Image"} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
