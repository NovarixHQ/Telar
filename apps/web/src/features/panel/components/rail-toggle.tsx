"use client";

import { PanelRightIcon } from "lucide-react";
import { KeyHintOverlay } from "@/features/commands";
import { HeaderToggle } from "@/ui/header-toggle";

export function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "Close right panel" : "Open right panel";
  return (
    <KeyHintOverlay command="toggle-panel">
      <HeaderToggle aria-label={label} aria-pressed={open} title={label} onClick={onToggle}>
        <PanelRightIcon />
      </HeaderToggle>
    </KeyHintOverlay>
  );
}
