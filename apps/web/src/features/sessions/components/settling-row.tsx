"use client";

import { useState } from "react";
import { MAX_AUTO_SETTLE_HOURS, MIN_AUTO_SETTLE_HOURS, DEFAULT_AUTO_SETTLE_HOURS } from "@telar/engine-client";
import { useInboxPolicy } from "../inbox-policy";
import { Input } from "@/ui/input";
import { Switch } from "@/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Row, useRestoreDefaults } from "@/features/settings";

type Unit = "hours" | "days";

const HOURS_PER: Record<Unit, number> = { hours: 1, days: 24 };
const MAX_BY_UNIT: Record<Unit, number> = { hours: MAX_AUTO_SETTLE_HOURS, days: MAX_AUTO_SETTLE_HOURS / 24 };

function unitFor(hours: number): Unit {
  return hours % 24 === 0 ? "days" : "hours";
}

function WindowInput({ hours, onCommit, label }: { hours: number; onCommit: (hours: number) => void; label: string }) {
  const [unit, setUnit] = useState<Unit>(unitFor(hours));
  const [draft, setDraft] = useState(String(hours / HOURS_PER[unitFor(hours)]));
  const [lastHours, setLastHours] = useState(hours);
  if (lastHours !== hours) {
    setLastHours(hours);
    const nextUnit: Unit = hours % HOURS_PER[unit] === 0 ? unit : "hours";
    if (nextUnit !== unit) setUnit(nextUnit);
    setDraft(String(hours / HOURS_PER[nextUnit]));
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={1}
        max={MAX_BY_UNIT[unit]}
        className="w-20"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          const asHours = parsed * HOURS_PER[unit];
          if (Number.isInteger(parsed) && asHours >= MIN_AUTO_SETTLE_HOURS && asHours <= MAX_AUTO_SETTLE_HOURS) onCommit(asHours);
        }}
        onBlur={() => setDraft(String(hours / HOURS_PER[unit]))}
        aria-label={label}
      />
      <Select
        value={unit}
        onValueChange={(next) => {
          if (next !== "hours" && next !== "days") return;
          if (hours % HOURS_PER[next] !== 0) return;
          setUnit(next);
          setDraft(String(hours / HOURS_PER[next]));
        }}
      >
        <SelectTrigger size="sm" className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hours">hours</SelectItem>
          <SelectItem value="days">days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function SettlingRow() {
  const { policy, loading, save, error } = useInboxPolicy();
  const hours = policy.autoSettleAfterHours;
  useRestoreDefaults(() => save({ autoSettleAfterHours: DEFAULT_AUTO_SETTLE_HOURS }));

  return (
    <Row
      keywords={["inbox", "archive", "auto", "shelf", "settled", "unsettle", "restore", "hidden", "put away", "quiet", "delegated", "errand", "result", "hours", "days", "window"]}
      label="Settle sessions"
      hint="A quiet session, or a delegated one whose result was delivered, leaves the rail after this long unless it is pinned or waiting on you."
      {...(error ? { error } : {})}
      {...(hours === DEFAULT_AUTO_SETTLE_HOURS ? {} : { onRevert: () => void save({ autoSettleAfterHours: DEFAULT_AUTO_SETTLE_HOURS }) })}
      control={
        <div className="flex items-center gap-3">
          {hours !== null && <WindowInput hours={hours} label="Settle sessions after" onCommit={(next) => void save({ autoSettleAfterHours: next })} />}
          <Switch
            checked={hours !== null}
            disabled={loading}
            onCheckedChange={(next: boolean) => void save({ autoSettleAfterHours: next ? DEFAULT_AUTO_SETTLE_HOURS : null })}
            aria-label="Settle sessions"
          />
        </div>
      }
    />
  );
}
