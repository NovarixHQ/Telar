"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { ChevronDownIcon } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/ui/button";
import { shouldRefollow } from "@/ui/scroll-follow";
import { cn } from "@/ui/utils";

export type ConversationFollowHandle = {
  toBottom: () => void;
};

const READER_GESTURES = ["wheel", "touchmove", "mousedown"] as const;
const READER_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

function releasesHold(event: Event, scroller: HTMLElement): boolean {
  if (event instanceof WheelEvent) return event.deltaY < 0;
  if (event instanceof KeyboardEvent) return READER_KEYS.has(event.key);
  if (event.type === "mousedown") return event.target === scroller;
  return event.type === "touchmove";
}

const ConversationFollow = ({ handle }: { handle?: Ref<ConversationFollowHandle> }) => {
  const { escapedFromLock, scrollToBottom, scrollRef, contentRef, state } = useStickToBottomContext();
  const gestureAt = useRef(Number.NEGATIVE_INFINITY);
  const held = useRef(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const mark = (event: Event) => {
      gestureAt.current = performance.now();
      if (releasesHold(event, element)) held.current = false;
    };
    let frame = 0;
    const keep = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (held.current && !state.animation && state.scrollDifference > 1) void scrollToBottom({ animation: "instant" });
      });
    };
    for (const kind of [...READER_GESTURES, "keydown"]) element.addEventListener(kind, mark, { passive: true });
    element.addEventListener("scroll", keep, { passive: true });
    const observer = new ResizeObserver(keep);
    observer.observe(element);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      for (const kind of [...READER_GESTURES, "keydown"]) element.removeEventListener(kind, mark);
      element.removeEventListener("scroll", keep);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scrollRef, contentRef, scrollToBottom, state]);

  useImperativeHandle(
    handle,
    () => ({
      toBottom: () => {
        gestureAt.current = Number.NEGATIVE_INFINITY;
        held.current = true;
        void scrollToBottom({ animation: "instant" });
      },
    }),
    [scrollToBottom],
  );

  useEffect(() => {
    if (!shouldRefollow({ escaped: escapedFromLock, distance: state.scrollDifference, gestureAgo: performance.now() - gestureAt.current })) {
      return;
    }
    void scrollToBottom({ animation: "instant" });
  }, [escapedFromLock, scrollToBottom, state]);

  return null;
};

export function nextPlacement(
  at: string,
  landed: boolean,
  settledAt: string | undefined,
): { place: boolean; settledAt: string | undefined } {
  if (settledAt === at) return { place: false, settledAt };
  return { place: true, settledAt: landed ? at : settledAt };
}

const ConversationPlacement = ({ at, landed }: { at: string; landed: boolean }) => {
  const { scrollToBottom } = useStickToBottomContext();
  const settledAt = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const next = nextPlacement(at, landed, settledAt.current);
    settledAt.current = next.settledAt;
    if (!next.place) return;
    void scrollToBottom({ animation: "instant" });
  });
  return null;
};

export const READING_BACK_PX = 200;

const ConversationAtBottom = ({ onChange }: { onChange: (atBottom: boolean) => void }) => {
  const { isAtBottom, scrollRef } = useStickToBottomContext();
  const reported = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const report = (atBottom: boolean) => {
      if (reported.current === atBottom) return;
      reported.current = atBottom;
      onChange(atBottom);
    };
    if (isAtBottom) return report(true);
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      if (element.scrollHeight - element.clientHeight - element.scrollTop > READING_BACK_PX) report(false);
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    return () => element.removeEventListener("scroll", measure);
  }, [isAtBottom, onChange, scrollRef]);
  return null;
};

const PREFETCH_MARGIN_PX = 400;

export function anchoredScrollTop(before: { scrollTop: number; scrollHeight: number }, after: { scrollHeight: number }): number {
  return before.scrollTop + (after.scrollHeight - before.scrollHeight);
}

export const ConversationTopEdge = ({
  more,
  loading,
  onReach,
  children,
}: {
  more: boolean;
  loading: boolean;
  onReach: () => void;
  children?: ReactNode;
}) => {
  const { scrollRef } = useStickToBottomContext();
  const edge = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ scrollTop: number; scrollHeight: number } | undefined>(undefined);
  const awaited = useRef(false);

  useEffect(() => {
    const root = scrollRef.current;
    const target = edge.current;
    if (!root || !target || !more || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        const element = scrollRef.current;
        if (element) anchor.current = { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight };
        onReach();
      },
      { root, rootMargin: `${PREFETCH_MARGIN_PX}px 0px 0px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [scrollRef, more, loading, onReach]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const held = anchor.current;
    if (!element || !held) return;
    if (element.scrollHeight > held.scrollHeight) {
      anchor.current = undefined;
      awaited.current = false;
      element.scrollTop = anchoredScrollTop(held, element);
      return;
    }
    if (loading) {
      awaited.current = true;
      return;
    }
    if (awaited.current) {
      anchor.current = undefined;
      awaited.current = false;
    }
  });

  if (!more && !loading) return null;
  return (
    <div>
      <div ref={edge} aria-hidden data-conversation-top-edge="" />
      {children}
    </div>
  );
};

export type ConversationViewportProps = ComponentProps<typeof StickToBottom> & {
  conversation?: string;
  landed?: boolean;
  followRef?: Ref<ConversationFollowHandle>;
  onAtBottomChange?: (atBottom: boolean) => void;
};

export const ConversationViewport = ({
  className,
  conversation,
  landed = true,
  followRef,
  onAtBottomChange,
  children,
  ...props
}: ConversationViewportProps) => {
  const placement = conversation === undefined ? null : <ConversationPlacement at={conversation} landed={landed} />;
  const follow = useMemo(() => <ConversationFollow {...(followRef ? { handle: followRef } : {})} />, [followRef]);
  const compose = (rendered: ReactNode) => (
    <>
      {rendered}
      {placement}
      {follow}
      {onAtBottomChange && <ConversationAtBottom onChange={onAtBottomChange} />}
    </>
  );
  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-hidden", className)}
      initial="instant"
      resize={landed ? "smooth" : "instant"}
      role="log"
      {...props}
    >
      {typeof children === "function" ? (context) => compose(children(context)) : compose(children)}
    </StickToBottom>
  );
};

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 py-6 px-4", className)}
    {...props}
  />
);

export const ConversationScrollButton = () => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const onClick = useCallback(() => {
    void scrollToBottom({ animation: "smooth" });
  }, [scrollToBottom]);

  if (isAtBottom) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <Button
        className="pointer-events-auto rounded-full border-border/60 bg-background/80 text-foreground shadow-2 backdrop-blur-md hover:border-border dark:bg-background/70"
        onClick={onClick}
        onPointerDown={(event) => event.preventDefault()}
        size="xs"
        type="button"
        variant="outline"
      >
        <ChevronDownIcon className="size-3.5" />
        Scroll to end
      </Button>
    </div>
  );
};
