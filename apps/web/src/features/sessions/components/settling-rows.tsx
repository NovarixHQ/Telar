"use client";

import { useState } from "react";
import {
  MAX_AUTO_SETTLE_HOURS,
  MIN_AUTO_SETTLE_HOURS,
  DEFAULT_AUTO_SETTLE_HOURS,
  DEFAULT_SETTLE_DELEGATED_AFTER_HOURS,
  DEFAULT_INBOX_POLICY,
} from "@telar/engine-client";
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

export function SettlingRows() {
  const { policy, loading, save, error } = useInboxPolicy();
  const hours = policy.autoSettleAfterHours;
  const delegated = policy.settleDelegatedAfterHours;
  useRestoreDefaults(() =>
    save({
      autoSettleAfterHours: DEFAULT_INBOX_POLICY.autoSettleAfterHours,
      settleDelegatedAfterHours: DEFAULT_INBOX_POLICY.settleDelegatedAfterHours,
    }),
  );

  const settleControl = ({ value, fallback, label, key }: { value: number | null; fallback: number; label: string; key: "autoSettleAfterHours" | "settleDelegatedAfterHours" }) => (
    <div className="flex items-center gap-3">
      {value !== null && <WindowInput hours={value} label={`${label} after`} onCommit={(next) => void save({ [key]: next })} />}
      <Switch checked={value !== null} disabled={loading} onCheckedChange={(next: boolean) => void save({ [key]: next ? fallback : null })} aria-label={label} />
    </div>
  );

  return (
    <>
      <Row
        keywords={["inbox", "archive", "auto", "shelf", "settled", "unsettle", "restore", "hidden", "put away", "quiet", "hours", "days", "window"]}
        label="Settle quiet sessions"
        hint="Pinned sessions and open questions stay put."
        {...(error ? { error } : {})}
        {...(hours === DEFAULT_INBOX_POLICY.autoSettleAfterHours
          ? {}
          : { onRevert: () => void save({ autoSettleAfterHours: DEFAULT_INBOX_POLICY.autoSettleAfterHours }) })}
        control={settleControl({ value: hours, fallback: DEFAULT_AUTO_SETTLE_HOURS, label: "Settle quiet sessions", key: "autoSettleAfterHours" })}
      />
      <Row
        keywords={["delegated", "errand", "coordinator", "handoff", "result", "settle", "hours", "days", "window"]}
        label="Settle delegated sessions"
        hint="Once their result is delivered. A failed errand, a pinned row and an open question all stay put."
        {...(delegated === DEFAULT_INBOX_POLICY.settleDelegatedAfterHours
          ? {}
          : { onRevert: () => void save({ settleDelegatedAfterHours: DEFAULT_INBOX_POLICY.settleDelegatedAfterHours }) })}
        control={settleControl({ value: delegated, fallback: DEFAULT_SETTLE_DELEGATED_AFTER_HOURS, label: "Settle delegated sessions", key: "settleDelegatedAfterHours" })}
      />
    </>
  );
}
