"use client";

import { ArrowLeftRightIcon } from "lucide-react";
import type { JournalItem } from "@/platform/engine";
import { driverLabel } from "@/features/providers";
import { ROW } from "./transcript-fold";

type Side = { driver: string; model?: string };

const sideLabel = (side: Side) => (side.model ? `${driverLabel(side.driver)} · ${side.model}` : driverLabel(side.driver));

export function ProviderSwitchRow({ item }: { item: JournalItem }) {
  if (item.detail.type !== "provider_switch") return null;
  const { from, to, carriedTurns } = item.detail;
  return (
    <p className={`${ROW} text-muted-foreground`}>
      <ArrowLeftRightIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Switched from {sideLabel(from)} to {sideLabel(to)}
      </span>
      {carriedTurns > 0 && <span className="shrink-0 text-3xs tabular-nums">{carriedTurns === 1 ? "1 turn carried" : `${carriedTurns} turns carried`}</span>}
    </p>
  );
}
