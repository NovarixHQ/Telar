"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { DEFAULT_AGENT_ORIENTATION, type AgentOrientation } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { Switch } from "@/ui/switch";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";

const api = createEngineApi();

export function OrientationSection() {
  const [policy, setPolicy] = useState<AgentOrientation>(DEFAULT_AGENT_ORIENTATION);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void api
        .orientation()
        .then((answer) => {
          setPolicy(answer.orientation);
          setText(answer.text);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const save = useCallback(async (patch: { preamble?: boolean; skill?: boolean }) => {
    try {
      const answer = await api.setOrientation(patch);
      setPolicy(answer.orientation);
      setText(answer.text);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The engine refused that change.");
    }
  }, []);

  useRestoreDefaults(() => save({ ...DEFAULT_AGENT_ORIENTATION }));

  const on = policy.preamble || policy.skill;
  const fallback = DEFAULT_AGENT_ORIENTATION.preamble || DEFAULT_AGENT_ORIENTATION.skill;

  return (
    <SettingsGroup title="Agent tools">
      <Row
        keywords={["orientation", "preamble", "system prompt", "prompt", "context", "skill", "SKILL.md", "instructions", "telar", "show the text"]}
        label="Tell agents they are inside Telar"
        hint="A paragraph each turn and a skill file for each provider, so agents read Telar's words the way you mean them."
        info="The paragraph says that the browser is Telar's, that a session is a Telar session, and what the panel and the rail are. The skill has the detail. Turning this off deletes the skill file."
        {...(error ? { error } : {})}
        {...(on === fallback ? {} : { onRevert: () => void save({ ...DEFAULT_AGENT_ORIENTATION }) })}
        control={
          <Switch
            checked={on}
            disabled={loading}
            onCheckedChange={(next: boolean) => void save({ preamble: next, skill: next })}
            aria-label="Tell agents they are inside Telar"
          />
        }
      >
        <button
          type="button"
          onClick={() => setShowing((open) => !open)}
          aria-expanded={showing}
          className="mt-1.5 flex items-center gap-1 rounded-sm text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon className={`size-3 shrink-0 transition-transform ${showing ? "rotate-90" : ""}`} />
          Show the text
        </button>
        {showing && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {text || "The engine did not answer."}
          </p>
        )}
      </Row>
    </SettingsGroup>
  );
}
