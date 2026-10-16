"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MAX_AGENT_INSTRUCTIONS } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Textarea } from "@/ui/textarea";
import { Row } from "@/features/settings";

const api = createEngineApi();

const INFO = `Changes apply from the next turn, up to ${MAX_AGENT_INSTRUCTIONS.toLocaleString("en-US")} characters. Global instructions come first, then the project's. Agents that take no standing instructions get them with the first message of a session and again after an edit.`;

export function InstructionsRow({
  hint,
  saved,
  onSave,
  saving,
  error,
  unavailable,
}: {
  hint: string;
  saved: string;
  onSave: (text: string) => void;
  saving?: boolean;
  error?: string;
  unavailable?: { reason: ReactNode };
}) {
  const [draft, setDraft] = useState<string>();
  const text = draft ?? saved;
  const changed = text.trim() !== saved;

  return (
    <Row
      keywords={["instructions", "system prompt", "rules", "custom instructions", "prompt"]}
      label="Agent instructions"
      hint={hint}
      info={INFO}
      {...(saving ? { status: <Badge variant="outline">Saving</Badge> } : {})}
      {...(error ? { error } : {})}
      {...(unavailable ? { unavailable } : {})}
    >
      <Textarea
        aria-label="Agent instructions"
        className="mt-2 max-h-80 font-mono text-xs"
        value={text}
        maxLength={MAX_AGENT_INSTRUCTIONS}
        placeholder="Answer in Spanish. Run the tests before you say a change works."
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {text.length} / {MAX_AGENT_INSTRUCTIONS}
        </span>
        {changed && (
          <>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setDraft(undefined)}>
              Discard
            </Button>
            <Button size="xs" disabled={saving} onClick={() => onSave(text)}>
              Save
            </Button>
          </>
        )}
      </div>
    </Row>
  );
}

export function GlobalInstructionsRow() {
  const [saved, setSaved] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const task = window.setTimeout(() => {
      void api
        .orientation()
        .then((answer) => setSaved(answer.orientation.instructions ?? ""))
        .catch(() => setError("The engine did not answer."));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const save = (text: string) => {
    setSaving(true);
    void api
      .setOrientation({ instructions: text })
      .then((answer) => {
        setSaved(answer.orientation.instructions ?? "");
        setError(undefined);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "The engine refused that change."))
      .finally(() => setSaving(false));
  };

  return (
    <InstructionsRow
      key={saved === undefined ? "loading" : "loaded"}
      hint="Sent to every agent with each turn, without touching any provider's own configuration."
      saved={saved ?? ""}
      onSave={save}
      saving={saving}
      {...(error ? { error } : {})}
    />
  );
}
