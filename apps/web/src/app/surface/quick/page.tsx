"use client";

import { Suspense } from "react";
import { QuickComposer } from "@/features/sessions";

export default function QuickComposerPage() {
  return (
    <Suspense fallback={null}>
      <QuickComposer />
    </Suspense>
  );
}
