"use client";

import { useSearchParams } from "next/navigation";
import { desktopBrowserBridge } from "../desktop-browser-bridge";
import { DesktopBrowserSurface } from "./desktop-browser-surface";

export function BrowserWindowSurface() {
  const params = useSearchParams();
  const scope = params.get("scope");
  const project = params.get("project");
  const bridge = desktopBrowserBridge();
  if (!bridge || !scope) {
    return <p className="flex h-dvh items-center justify-center p-6 text-xs text-muted-foreground">This window has no browser to show.</p>;
  }
  return (
    <div data-surfaces className="flex min-h-0 flex-1 overflow-hidden md:overflow-visible">
      <section aria-label="Browser window" className="flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-xl md:bg-sidebar md:shadow-1 md:ring-1 md:ring-sidebar-border">
        <DesktopBrowserSurface bridge={bridge} scopeKey={scope} {...(project ? { projectId: project } : {})} inWindow onEnded={() => window.close()} />
      </section>
    </div>
  );
}
