"use client";

import { useEffect } from "react";
import { quickComposerBridge } from "@/features/sessions";
import { LoadFailure } from "@/ui/load-failure";

export default function QuickComposerError({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => quickComposerBridge()?.failed(error.stack ?? String(error)), [error]);
  return <LoadFailure error={error} retry={retry} label="The quick composer" />;
}
