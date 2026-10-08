"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function resolveSection(raw: string | null, allowed: readonly string[]): string | null {
  return raw && allowed.includes(raw) ? raw : null;
}

export function useSectionFromUrl(
  fallback: string,
  allowed: readonly string[],
): [string, (next: string) => void, string | undefined] {
  const params = useSearchParams();
  const routed = resolveSection(params.get("section"), allowed);
  const row = params.get("row") ?? undefined;
  const [active, setActive] = useState(routed ?? fallback);
  const [seen, setSeen] = useState(routed);
  if (routed !== seen) {
    setSeen(routed);
    if (routed) setActive(routed);
  }
  return [active, setActive, row];
}
