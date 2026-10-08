import { Children, type ReactNode } from "react";
import { cn } from "@/ui/utils";

const VISIBLE_ROWS = 6;

export function SettingsList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  if (Children.toArray(children).length <= VISIBLE_ROWS) return <>{children}</>;
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "max-h-96 divide-y divide-border/60 overflow-y-auto overscroll-contain px-0! outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&>*]:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
