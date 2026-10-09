"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, Clock3Icon, CornerUpRightIcon, PencilIcon, XIcon } from "lucide-react";
import { Button } from "@/ui/button";

type QueuedMessage = { runId: string; text: string };

export type QueuedMessagesProps = {
  messages: readonly QueuedMessage[];
  onEdit: (runId: string, text: string) => void;
  onMove: (runId: string, beforeRunId: string | null) => void;
  onRemove: (runId: string) => void;
  onSendNow?: (runId: string) => void;
};

function EditRow({ text, onSave, onCancel }: { text: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  const save = () => (value.trim() ? onSave(value) : onCancel());
  return (
    <textarea
      aria-label="Edit queued message"
      autoFocus
      rows={Math.min(6, value.split("\n").length)}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          save();
        }
      }}
      className="min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  );
}

export function QueuedMessages({ messages, onEdit, onMove, onRemove, onSendNow }: QueuedMessagesProps) {
  const [editing, setEditing] = useState<string>();
  if (messages.length === 0) return null;
  return (
    <div className="mx-3 -mb-1">
      <ol aria-label="Queued messages" className="flex flex-col gap-0.5 rounded-t-xl border border-b-0 border-border/60 bg-muted/40 px-2 pt-1.5 pb-3 backdrop-blur-sm">
        {messages.map((message, index) => (
          <li key={message.runId} className="group flex items-center gap-1.5 rounded-md px-1 py-0.5">
            <Clock3Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {editing === message.runId ? (
              <EditRow
                text={message.text}
                onCancel={() => setEditing(undefined)}
                onSave={(text) => {
                  setEditing(undefined);
                  if (text !== message.text) onEdit(message.runId, text);
                }}
              />
            ) : (
              <p className="min-w-0 flex-1 truncate text-xs" title={message.text}>{message.text}</p>
            )}
            <div className="flex shrink-0 items-center opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
              {onSendNow && (
                <Button variant="ghost" size="icon-xs" aria-label="Send now" title="Send into the running turn" onClick={() => onSendNow(message.runId)}>
                  <CornerUpRightIcon />
                </Button>
              )}
              <Button variant="ghost" size="icon-xs" aria-label="Edit" onClick={() => setEditing(message.runId)}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={index === 0} onClick={() => onMove(message.runId, messages[index - 1]!.runId)}>
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Move down"
                disabled={index === messages.length - 1}
                onClick={() => onMove(message.runId, messages[index + 2]?.runId ?? null)}
              >
                <ArrowDownIcon />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => onRemove(message.runId)}>
                <XIcon />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
