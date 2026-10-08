import { cn } from "./utils";

/** A pulsing placeholder block; size it with `className`. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted/60", className)} />;
}
