import { Children, type ReactNode } from "react";
import { cn } from "@/ui/utils";

const VISIBLE_ROWS = 6;

/** Rows of a list that grows with use: past a handful it scrolls inside its group instead of stretching the page. */
export function SettingsList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  if (Children.toArray(children).length <= VISIBLE_ROWS) return <>{children}</>;
  return <ScrollBox label={label} className={cn("divide-y divide-border/60 [&>*]:px-4", className)}>{children}</ScrollBox>;
}

export function ScrollBox({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("max-h-96 overflow-y-auto overscroll-contain px-0! outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", className)}
    >
      {children}
    </div>
  );
}
