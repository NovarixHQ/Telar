"use client";

import { useEffect } from "react";
import { quickComposerBridge } from "@/features/sessions";
import { Button } from "@/ui/button";
import { LoadFailure } from "@/ui/load-failure";

function errorReport(error: Error) {
  const stack = (error.stack ?? "").split("\n").filter((line) => line.trim().startsWith("at ")).slice(0, 6);
  return [`${error.name}: ${error.message}`, ...stack.map((line) => line.trim())].join("\n");
}

export default function QuickComposerError({ error, retry }: { error: Error; retry: () => void }) {
  const report = errorReport(error);
  useEffect(() => quickComposerBridge()?.failed(error.stack ?? String(error)), [error]);
  return (
    <div className="m-4 flex flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2">
      <LoadFailure error={error} retry={retry} label="This page" />
      <pre data-slot="quick-error" className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-3xs leading-4 whitespace-pre-wrap select-text">{report}</pre>
      <Button size="xs" variant="ghost" className="self-end" onClick={() => void navigator.clipboard?.writeText(report)}>Copy</Button>
    </div>
  );
}
