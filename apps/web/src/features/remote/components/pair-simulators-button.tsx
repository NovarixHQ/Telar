"use client";

import { useState } from "react";
import { Button } from "@/ui/button";
import { desktopDev } from "@/platform/desktop/desktop-dev";

export function PairSimulatorsButton() {
  const dev = desktopDev();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!dev) return null;
  const pair = () => {
    setBusy(true);
    dev
      .pairSimulators()
      .then((result) => setMessage(result.message))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Pairing failed."))
      .finally(() => setBusy(false));
  };
  return (
    <>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      <Button variant="outline" size="sm" disabled={busy} onClick={pair}>
        {busy ? "Pairing…" : "Pair booted simulators"}
      </Button>
    </>
  );
}
