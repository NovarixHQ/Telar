import { Suspense } from "react";
import { SettingsPage } from "@/features/settings";

export default function Settings() {
  // `h-full`, not `h-dvh`: this page renders inside the app shell's inset, which
  // is already viewport-height. A second full-viewport box inside it is what
  // pushes the settings pane's own scroll container past the fold.
  return (
    <div className="h-full min-h-0">
      <Suspense fallback={null}>
        <SettingsPage />
      </Suspense>
    </div>
  );
}
