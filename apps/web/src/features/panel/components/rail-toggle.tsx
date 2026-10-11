"use client";

import { PanelRightIcon } from "lucide-react";
import { KeyHintOverlay } from "@/features/commands";
import { HeaderToggle } from "@/ui/header-toggle";

export function RailToggle({ open, onToggle, hint = false }: { open: boolean; onToggle: () => void; hint?: boolean }) {
  const label = open ? "Close right panel" : "Open right panel";
  const toggle = (
    <HeaderToggle aria-label={label} aria-pressed={open} title={label} onClick={onToggle}>
      <PanelRightIcon />
    </HeaderToggle>
  );
  return hint ? <KeyHintOverlay command="toggle-panel">{toggle}</KeyHintOverlay> : toggle;
}
