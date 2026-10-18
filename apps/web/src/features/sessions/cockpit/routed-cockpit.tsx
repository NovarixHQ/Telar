"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { SessionCockpit } from "./components/session-cockpit";

const ROUTE = /\/projects\/([^/]+)\/sessions\/([^/]+?)(\/solo)?\/?$/;

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function cockpitRoute(pathname: string): { projectId: string; sessionId?: string; solo: boolean } | undefined {
  const match = ROUTE.exec(pathname);
  if (!match) return undefined;
  return { projectId: decode(match[1]!), sessionId: match[2] === "new" ? undefined : decode(match[2]!), solo: Boolean(match[3]) };
}

/** The cockpit for the address bar: a static export prerenders one placeholder page, so ids come from the URL, not from route params. */
export function RoutedCockpit() {
  const route = cockpitRoute(usePathname());
  if (!route) return null;
  return (
    <Suspense fallback={null}>
      <SessionCockpit {...route} />
    </Suspense>
  );
}
