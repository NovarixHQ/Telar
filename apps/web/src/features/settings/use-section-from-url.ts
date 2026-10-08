"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export function resolveSection(raw: string | null, allowed: readonly string[]): string | null {
  return raw && allowed.includes(raw) ? raw : null;
}

export function useSectionFromUrl(fallback: string, allowed: readonly string[]): [string, (next: string) => void] {
  const params = useSearchParams();
  return useState(() => resolveSection(params.get("section"), allowed) ?? fallback);
}
