"use client";

import { CloudOffIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { describeLoadError, type PageLoadError } from "../load-error";

/** The page area when the tab's page failed to load; `onRetry` is absent where the page can't be driven. */
export function LoadErrorPage({ error, onRetry }: { error: PageLoadError; onRetry?: () => void }) {
  const { title, host, reason } = describeLoadError(error);
  return (
    <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <CloudOffIcon aria-hidden className="mb-1 size-6 text-muted-foreground" />
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="font-mono text-xs text-muted-foreground">{host}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{reason}</p>
      {onRetry && (
        <Button variant="outline" size="xs" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
