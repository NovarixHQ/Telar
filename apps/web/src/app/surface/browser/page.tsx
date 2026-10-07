import { Suspense } from "react";
import { BrowserWindowSurface } from "@/features/browser";

export default function BrowserSurfacePage() {
  return (
    <Suspense fallback={null}>
      <BrowserWindowSurface />
    </Suspense>
  );
}
