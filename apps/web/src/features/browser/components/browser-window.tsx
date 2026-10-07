"use client";

import { useSearchParams } from "next/navigation";
import { useMenuCommands } from "@/features/commands";
import { desktopBrowserBridge } from "../desktop-browser-bridge";
import { DesktopBrowserSurface } from "./desktop-browser-surface";

export function BrowserWindowSurface() {
  const params = useSearchParams();
  const scope = params.get("scope");
  const project = params.get("project");
  const bridge = desktopBrowserBridge();
  useMenuCommands();
  if (!bridge || !scope) {
    return <p className="flex h-dvh items-center justify-center p-6 text-xs text-muted-foreground">This window has no browser to show.</p>;
  }
  return (
    <div className="h-dvh">
      <DesktopBrowserSurface bridge={bridge} scopeKey={scope} {...(project ? { projectId: project } : {})} inWindow onEnded={() => window.close()} />
    </div>
  );
}
