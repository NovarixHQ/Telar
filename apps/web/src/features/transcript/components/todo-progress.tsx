"use client";

import { useEffect, useState } from "react";
import { ListTodoIcon } from "lucide-react";
import type { JournalItem } from "@telar/client/journal";

function usePlanRowVisible(itemId: string | undefined): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const row = itemId ? document.querySelector(`[data-plan-row="${CSS.escape(itemId)}"]`) : null;
    if (!row) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    observer.observe(row);
    return () => observer.disconnect();
  }, [itemId]);
  return visible;
}

export function TodoProgress({ items }: { items: readonly JournalItem[] | undefined }) {
  const plan = items?.findLast((item) => item.detail.type === "plan");
  const visible = usePlanRowVisible(plan?.id);
  if (!plan || plan.detail.type !== "plan" || visible) return null;
  const steps = plan.detail.plan.steps;
  const done = steps.filter((step) => step.status === "completed").length;
  const current = steps.find((step) => step.status === "inProgress") ?? steps.find((step) => step.status === "pending");
  if (!current) return null;
  return (
    <div role="status" className="mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-1.5 px-3 pb-1 text-xs text-muted-foreground">
      <ListTodoIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-foreground">{current.step}</span>
      <span className="shrink-0 font-mono text-3xs">
        {done} of {steps.length} done
      </span>
    </div>
  );
}
