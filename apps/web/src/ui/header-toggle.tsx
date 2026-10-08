import type { ComponentProps } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";

export function HeaderToggle({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "relative text-muted-foreground hover:text-foreground [&_svg]:size-4",
        "aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border/80 aria-pressed:hover:bg-accent",
        "data-popup-open:bg-accent data-popup-open:text-foreground data-popup-open:ring-1 data-popup-open:ring-border/80",
        className,
      )}
      {...props}
    />
  );
}

export function HeaderToggleGroup({ className, ...props }: ComponentProps<"div">) {
  return <div role="group" className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}
