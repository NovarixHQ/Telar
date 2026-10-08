"use client";

import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/ui/button";

/** The masthead control that opens and closes the panel, so it stays put either way. */
export function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "Close right panel" : "Open right panel";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={onToggle}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      {open ? <PanelRightCloseIcon className="size-4" /> : <PanelRightOpenIcon className="size-4" />}
    </Button>
  );
}
