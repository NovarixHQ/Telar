"use client";

import { useEffect } from "react";
import { quickComposerBridge } from "@/features/sessions";
import { Button } from "@/ui/button";
import { LoadFailure } from "@/ui/load-failure";

const frames = (error: Error) => (error.stack ?? "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("at "));

export default function QuickComposerError({ error, retry }: { error: Error; retry: () => void }) {
  const message = `${error.name}: ${error.message}`;
  const stack = frames(error).join("\n");
  useEffect(() => {
    quickComposerBridge()?.failed(error.stack ?? String(error));
  }, [error]);
  return (
    <div className="m-6 flex flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2">
      <LoadFailure error={error} retry={retry} label="This page" />
      <p data-slot="quick-error-message" className="font-mono text-2xs break-words select-text">{message}</p>
      {stack && <pre data-slot="quick-error-stack" className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-3xs leading-4 select-text">{stack}</pre>}
      <Button size="xs" variant="ghost" className="self-end" onClick={() => void navigator.clipboard?.writeText(stack ? `${message}\n${stack}` : message)}>Copy</Button>
    </div>
  );
}
