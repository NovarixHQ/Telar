"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/ui/spinner";
import type { ComposerExtensions } from "../decorations";
import type { DecorationFocus } from "./composer-editor";

const PREVIEW_DELAY_MS = 300;

function mathOf(text: string): { math: string; display: boolean } {
  const display = text.startsWith("$$") && text.endsWith("$$") && text.length > 4;
  const math = display ? text.slice(2, -2) : text.replace(/^\$/, "").replace(/\$$/, "");
  return { math: math.trim(), display };
}

function KatexPreview({ text }: { text: string }) {
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const { math, display } = mathOf(text);
    void import("katex").then(({ default: katex }) => {
      if (!cancelled) setHtml(katex.renderToString(math, { throwOnError: false, displayMode: display, output: "html" }));
    });
    return () => {
      cancelled = true;
    };
  }, [text]);
  // KaTeX escapes the source and `trust` stays off, so the markup carries no input of its own.
  return html ? <div data-slot="decoration-preview-math" className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} /> : null;
}

function RoutePreview({ text, plugin, verb, call }: { text: string; plugin: string; verb: string; call: NonNullable<ComposerExtensions["call"]> }) {
  const [answer, setAnswer] = useState<{ for: string; text: string }>();
  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      void call(plugin, verb, text).then(
        (preview) => !cancelled && setAnswer({ for: text, text: preview }),
        () => !cancelled && setAnswer({ for: text, text: "" }),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, [text, plugin, verb, call]);
  return answer?.for === text && answer.text ? <p className="whitespace-pre-wrap">{answer.text}</p> : null;
}

export function DecorationPreview({ focus, call }: { focus: DecorationFocus | undefined; call: ComposerExtensions["call"] }) {
  const preview = focus?.decoration.preview;
  if (!focus || !preview) return null;
  const body =
    "renderer" in preview ? (
      <KatexPreview text={focus.text} />
    ) : call ? (
      <RoutePreview text={focus.text} plugin={focus.decoration.plugin} verb={preview.verb} call={call} />
    ) : null;
  if (!body) return null;
  return (
    <div data-slot="decoration-preview" role="status" className="mb-1.5 max-h-40 overflow-y-auto rounded-xl border border-border/60 bg-card/95 px-3 py-2 text-sm shadow-1 backdrop-blur-xl">
      {body}
    </div>
  );
}

export function PluginCommandStatus({ running, error, onDismiss }: { running?: string | undefined; error?: string | undefined; onDismiss: () => void }) {
  if (!running && !error) return null;
  return (
    <div data-slot="plugin-command-status" role="status" className="mb-1.5 flex items-center gap-2 rounded-xl border border-border/60 bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-1">
      {running ? (
        <>
          <Spinner className="size-3" />
          <span>Running /{running}…</span>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-destructive">{error}</span>
          <button type="button" onClick={onDismiss} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
