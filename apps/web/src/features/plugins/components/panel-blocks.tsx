"use client";

import { useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FileTextIcon, TriangleAlertIcon } from "lucide-react";
import type { PluginPanelBlock } from "@telar/engine-client";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { MessageResponse } from "@/ui/message";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { cn } from "@/ui/utils";

type Cell = string | number | boolean | null;

/** A verb to call with its input; `confirm` is asked first. */
export type PluginBlockCall = { verb: string; input?: Record<string, unknown>; confirm?: string };

export type PluginBlockHandlers = {
  onCall: (call: PluginBlockCall, index: number) => void;
  onOpenFile?: (path: string) => void;
  onPrompt?: (text: string) => void;
};

const cellText = (value: Cell) => (value === null ? "—" : String(value));
const NONE = "__none";

const TONE: Record<"ok" | "error" | "warning" | "neutral", string> = {
  ok: "bg-success/15 text-success",
  error: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  neutral: "bg-muted text-muted-foreground",
};

export function PluginBlocks({ blocks, pending, onCall, onOpenFile, onPrompt }: { blocks: readonly PluginPanelBlock[]; pending?: number } & PluginBlockHandlers) {
  const busy = pending !== undefined;
  const call = (target: PluginBlockCall, index: number) => {
    if (target.confirm && !window.confirm(target.confirm)) return;
    onCall(target, index);
  };
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <h3 key={index} className="font-heading text-sm font-medium">
                {block.text}
              </h3>
            );
          case "text":
            return block.markdown ? (
              <MessageResponse key={index} className="text-xs">
                {block.text}
              </MessageResponse>
            ) : (
              <p key={index} className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {block.text}
              </p>
            );
          case "keyValue":
            return (
              <dl key={index} className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                {block.items.map((item, row) => (
                  <div key={row} className="contents">
                    <dt className="text-muted-foreground">{item.key}</dt>
                    <dd className="min-w-0 truncate font-mono">{cellText(item.value)}</dd>
                  </div>
                ))}
              </dl>
            );
          case "table":
            return (
              <div key={index} className="max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      {block.columns.map((column, col) => (
                        <th key={col} className="px-2 py-1 font-medium">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border last:border-0">
                        {block.columns.map((_, col) => (
                          <td key={col} className="px-2 py-1 font-mono">
                            {cellText(row[col] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "log":
            return <LogBlock key={index} lines={block.lines} {...(block.title ? { title: block.title } : {})} collapsed={block.collapsed === true} />;
          case "action":
            return block.field ? (
              <FieldAction key={index} block={block} field={block.field} busy={busy} pending={pending === index} onSubmit={(input) => call({ ...block, input }, index)} />
            ) : (
              <Button key={index} variant="outline" size="sm" className={cn("self-start", pending === index && "animate-pulse")} disabled={busy} onClick={() => call(block, index)}>
                {block.label}
              </Button>
            );
          case "status":
            return (
              <span key={index} className={cn("self-start rounded-full px-2 py-0.5 text-2xs font-medium", TONE[block.tone])}>
                {block.text}
              </span>
            );
          case "issues":
            return <IssueList key={index} items={block.items} {...(onOpenFile ? { onOpenFile } : {})} />;
          case "file":
            return (
              <Button key={index} variant="ghost" size="sm" className="self-start" disabled={!onOpenFile} onClick={() => onOpenFile?.(block.path)}>
                <FileTextIcon className="size-3" /> {block.label}
              </Button>
            );
          case "select":
            return (
              <div key={index} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{block.label}</span>
                  {block.hint && <span className="block text-2xs text-muted-foreground">{block.hint}</span>}
                </span>
                <Select
                  value={block.value || NONE}
                  disabled={busy}
                  onValueChange={(next) => call({ verb: block.verb, input: { [block.name]: typeof next === "string" && next !== NONE ? next : "" } }, index)}
                >
                  <SelectTrigger size="sm" className="w-56" aria-label={block.label}>
                    <SelectValue>{block.options.find((option) => option.value === (block.value ?? ""))?.label ?? block.value}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {block.options.map((option) => (
                      <SelectItem key={option.value || NONE} value={option.value || NONE}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          case "option":
            return (
              <div key={index} className={cn("flex flex-col gap-1 rounded-md border px-3 py-2", block.selected ? "border-primary bg-primary/5" : "border-border")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{block.title}</span>
                  {block.badge && <Badge variant="outline">{block.badge}</Badge>}
                  <span className="ml-auto">
                    {block.selected ? (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <CheckIcon className="size-3.5" /> In use
                      </span>
                    ) : block.action ? (
                      <Button size="xs" variant="outline" disabled={busy} onClick={() => call(block.action!, index)}>
                        {block.action.label}
                      </Button>
                    ) : null}
                  </span>
                </div>
                {block.detail && <p className="text-xs text-muted-foreground">{block.detail}</p>}
              </div>
            );
          case "prompt":
            return (
              <Button key={index} variant="outline" size="sm" className="self-start" disabled={!onPrompt} onClick={() => onPrompt?.(block.text)}>
                {block.label}
              </Button>
            );
        }
      })}
    </div>
  );
}

function LogBlock({ lines, title, collapsed }: { lines: readonly string[]; title?: string; collapsed: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  const body = (
    <pre role="log" className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-3xs leading-relaxed whitespace-pre-wrap">
      {lines.join("\n")}
    </pre>
  );
  if (!title) return body;
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 self-start text-2xs font-medium text-muted-foreground hover:text-foreground">
        {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
        {title}
      </button>
      {open && body}
    </div>
  );
}

type ActionBlock = Extract<PluginPanelBlock, { type: "action" }>;

function FieldAction({
  block,
  field,
  busy,
  pending,
  onSubmit,
}: {
  block: ActionBlock;
  field: NonNullable<ActionBlock["field"]>;
  busy: boolean;
  pending: boolean;
  onSubmit: (input: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(field.value ?? "");
  const submit = () => onSubmit({ ...block.input, [field.name]: draft.trim() });
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input value={draft} placeholder={field.placeholder} aria-label={block.label} className="h-7 min-w-0 flex-1 font-mono text-2xs" onChange={(event) => setDraft(event.target.value)} />
      <Button type="submit" size="sm" variant="outline" disabled={busy} className={cn(pending && "animate-pulse")}>
        {block.label}
      </Button>
    </form>
  );
}

type Issue = Extract<PluginPanelBlock, { type: "issues" }>["items"][number];

function IssueList({ items, onOpenFile }: { items: readonly Issue[]; onOpenFile?: (path: string) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((issue, index) => (
        <li key={index}>
          <button
            type="button"
            disabled={!issue.file || !onOpenFile}
            onClick={() => issue.file && onOpenFile?.(issue.file)}
            className={cn("flex w-full items-start gap-2 rounded-md border border-border px-2.5 py-1.5 text-left", issue.file && onOpenFile && "hover:bg-muted/50")}
          >
            <TriangleAlertIcon className={cn("mt-0.5 size-3 shrink-0", issue.severity === "error" ? "text-destructive" : "text-warning")} aria-label={issue.severity} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs leading-snug text-foreground">{issue.message}</span>
              <span className="block truncate text-2xs text-muted-foreground">
                {issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : issue.severity}
                {issue.detail ? ` — ${issue.detail}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
