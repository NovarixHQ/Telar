"use client";

import { PanelRightIcon } from "lucide-react";
import { HeaderToggle } from "@/ui/header-toggle";

export function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "Close right panel" : "Open right panel";
  return (
    <HeaderToggle aria-label={label} aria-pressed={open} title={label} onClick={onToggle}>
      <PanelRightIcon />
    </HeaderToggle>
  );
}
