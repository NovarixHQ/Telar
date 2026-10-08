"use client";

import { useEffect, useState } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { isChunkLoadError, reloadForNewBuild, reloadIsDue } from "@/platform/chunk-reload";
import { Button } from "./button";

export function LoadFailure({ error, retry, label }: { error: unknown; retry: () => void; label: string }) {
  const [reloading] = useState(() => isChunkLoadError(error) && reloadIsDue());
  useEffect(() => {
    if (reloading) reloadForNewBuild();
  }, [reloading]);
  if (reloading) return null;
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-xs text-muted-foreground">{label} couldn’t load.</p>
      <Button variant="outline" size="xs" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

function SurfaceFallback({ label = "This surface", resetKey }: { label?: string; resetKey?: string }, { error, retry, reset }: ErrorInfo) {
  return <ResettingFailure error={error} retry={retry} reset={reset} label={label} resetKey={resetKey} />;
}

function ResettingFailure({ resetKey, reset, ...failure }: { error: unknown; retry: () => void; reset: () => void; label: string; resetKey: string | undefined }) {
  const [failedAt] = useState(resetKey);
  useEffect(() => {
    if (resetKey !== failedAt) reset();
  }, [resetKey, failedAt, reset]);
  return <LoadFailure {...failure} />;
}

export const SurfaceBoundary = catchError(SurfaceFallback);
