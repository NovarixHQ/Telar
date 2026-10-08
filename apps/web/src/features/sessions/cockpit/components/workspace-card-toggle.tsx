"use client";

import { LayoutDashboardIcon } from "lucide-react";
import { HeaderToggle } from "@/ui/header-toggle";
import { useWorkspaceCardOpen } from "../hooks/use-workspace-card";

export function WorkspaceCardToggle() {
  const { open, toggle } = useWorkspaceCardOpen();
  return (
    <HeaderToggle aria-label="Workspace" aria-pressed={open} title="Workspace (⌥⌘W)" onClick={toggle}>
      <LayoutDashboardIcon />
    </HeaderToggle>
  );
}
