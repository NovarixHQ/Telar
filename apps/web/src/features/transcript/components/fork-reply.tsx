"use client";

import { createContext, useContext, useState } from "react";
import { GitForkIcon } from "lucide-react";

/** Starts a new session from the conversation through `runId`; absent where forking makes no sense. */
export const ForkReply = createContext<((runId: string) => Promise<void>) | undefined>(undefined);

export function ForkReplyButton({ runId }: { runId: string }) {
  const fork = useContext(ForkReply);
  const [busy, setBusy] = useState(false);
  if (!fork) return null;
  return (
    <button
      type="button"
      aria-label="Fork from here"
      title="Fork from here"
      disabled={busy}
      className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      onClick={() => {
        setBusy(true);
        void fork(runId).finally(() => setBusy(false));
      }}
    >
      <GitForkIcon className="size-3.5" />
    </button>
  );
}
