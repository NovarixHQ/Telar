"use client";

import { useState } from "react";
import { DEFAULT_SETTLED_TERMINAL_LIMIT, MAX_SETTLED_TERMINAL_LIMIT } from "@telar/engine-client";
import { Input } from "@/ui/input";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";
import { useInboxPolicy } from "../inbox-policy";

function CountInput({ value, onCommit, label }: { value: number; onCommit: (value: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setDraft(String(value));
  }
  return (
    <Input
      type="number"
      min={0}
      max={MAX_SETTLED_TERMINAL_LIMIT}
      className="w-20"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SETTLED_TERMINAL_LIMIT) onCommit(parsed);
      }}
      onBlur={() => setDraft(String(value))}
      aria-label={label}
    />
  );
}

export function SettledTerminalsSection() {
  const { policy, save, error } = useInboxPolicy();
  const terminalLimit = policy.settledTerminalLimit ?? DEFAULT_SETTLED_TERMINAL_LIMIT;
  useRestoreDefaults(() => save({ settledTerminalLimit: DEFAULT_SETTLED_TERMINAL_LIMIT }));

  return (
    <SettingsGroup title="Terminals">
      <Row
        label="Terminals settled sessions may keep open"
        info="Counted across every project on this computer, shells you opened included. Past it, the session settled longest ago has its terminals closed first, and its row says so. Settling one yourself closes its terminals at once; one settled automatically keeps them for 30 minutes."
        {...(error ? { error } : {})}
        {...(terminalLimit === DEFAULT_SETTLED_TERMINAL_LIMIT
          ? {}
          : { onRevert: () => void save({ settledTerminalLimit: DEFAULT_SETTLED_TERMINAL_LIMIT }) })}
        control={
          <CountInput
            value={terminalLimit}
            label="How many terminals settled sessions may keep open"
            onCommit={(next) => void save({ settledTerminalLimit: next })}
          />
        }
      />
    </SettingsGroup>
  );
}
