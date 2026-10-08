import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/ui/utils";

const HOVER = "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.08]";
const ROW =
  "flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-xs-plus font-medium text-foreground/85 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>svg]:text-muted-foreground";

/** A full-width row that acts on press: an icon, a label, then whatever trails it. */
export function ActionRow({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" className={cn(ROW, HOVER, "w-full active:scale-[0.99] data-popup-open:bg-foreground/[0.06]", className)} {...props} />;
}

/** A row that does its main thing in one press and keeps the alternatives behind a chevron. */
export function SplitRow({ children, menu, className }: { children: ReactNode; menu: ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full min-w-0 items-center rounded-lg transition-colors has-data-popup-open:bg-foreground/[0.06]", HOVER, className)}>
      {children}
      <span aria-hidden className="h-4 w-px shrink-0 bg-border/70" />
      {menu}
    </div>
  );
}

export function SplitRowMain({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" className={cn(ROW, "min-w-0 flex-1 rounded-e-none", className)} {...props} />;
}

export function SplitRowChevron({ className, children, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-e-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-popup-open:text-foreground [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      {children ?? <ChevronDownIcon />}
    </button>
  );
}

export function RowMeta({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("shrink-0 font-mono text-2xs font-normal text-muted-foreground tabular-nums", className)} {...props} />;
}
