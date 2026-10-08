import type { ReactNode } from "react";
import { cn } from "@/ui/utils";

/** The title row of a main pane: a breadcrumb on the left, controls on the right, no divider below. */
export function MainHeader({ leftmost, children }: { leftmost: boolean; children: ReactNode }) {
  return (
    <header
      className={cn(
        "app-drag flex min-h-[var(--titlebar-height)] shrink-0 items-center gap-2 py-1.5 pr-3 md:h-[var(--titlebar-band-height)] md:min-h-[var(--titlebar-band-height)] md:py-0",
        // The traffic-light inset is measured from the content island, not the window edge.
        leftmost ? "pl-[max(16px,calc(var(--titlebar-inset)+var(--app-island-inset)))]" : "pl-4",
      )}
    >
      {children}
    </header>
  );
}

export function MainBreadcrumb({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className="mr-1 flex min-w-0 flex-1 items-center gap-2 text-sm">
      {children}
    </nav>
  );
}

export function BreadcrumbSeparator() {
  return <span aria-hidden className="shrink-0 text-border">/</span>;
}
