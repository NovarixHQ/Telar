"use client";

import type * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "./utils";

type ScrollAreaProps = Omit<ScrollAreaPrimitive.Root.Props, "className"> & {
  className?: string;
  orientation?: "vertical" | "horizontal";
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: Omit<React.ComponentProps<"div">, "className" | "ref">;
};

/**
 * A scroller whose scrollbar never takes layout space, whatever the system scroll-bar setting.
 * Vertical shows an overlay thumb while scrolling or hovered; horizontal hides it and fades the overflowing edge.
 */
export function ScrollArea({ className, orientation = "vertical", viewportClassName, viewportRef, viewportProps, children, ...props }: ScrollAreaProps) {
  const horizontal = orientation === "horizontal";
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("group/scroll relative flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        {...viewportProps}
        onWheel={horizontal ? (event) => wheelSideways(event, viewportProps?.onWheel) : viewportProps?.onWheel}
        className={cn(
          "min-h-0 min-w-0 grow overscroll-contain outline-none",
          horizontal &&
            "[--fade:1.5rem] group-data-[overflow-x-start]/scroll:mask-l-from-[calc(100%-var(--fade))] group-data-[overflow-x-end]/scroll:mask-r-from-[calc(100%-var(--fade))]",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!horizontal && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="vertical"
          data-slot="scroll-area-scrollbar"
          className="my-1 mr-px flex w-1.5 opacity-0 transition-opacity delay-300 data-hovering:opacity-100 data-hovering:delay-0 data-scrolling:opacity-100 data-scrolling:delay-0"
        >
          <ScrollAreaPrimitive.Thumb className="w-full rounded-full bg-muted-foreground/35 hover:bg-muted-foreground/55" />
        </ScrollAreaPrimitive.Scrollbar>
      )}
    </ScrollAreaPrimitive.Root>
  );
}

/** A mouse wheel only scrolls vertically; on a sideways strip it should move the strip. Trackpads already send deltaX. */
function wheelSideways(event: React.WheelEvent<HTMLDivElement>, onWheel: React.WheelEventHandler<HTMLDivElement> | undefined) {
  onWheel?.(event);
  const strip = event.currentTarget;
  if (event.defaultPrevented || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
  strip.scrollLeft += event.deltaY;
}
