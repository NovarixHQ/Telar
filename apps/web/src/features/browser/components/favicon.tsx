"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/ui/utils";

export function Favicon({ src, fallback = null, className }: { src: string | null | undefined; fallback?: ReactNode; className?: string }) {
  const [broken, setBroken] = useState<string>();
  if (!src || broken === src) return fallback;
  // eslint-disable-next-line @next/next/no-img-element -- page-supplied favicon URL; nothing for next/image here
  return <img src={src} alt="" aria-hidden onError={() => setBroken(src)} className={cn("shrink-0 rounded-[2px]", className)} />;
}
