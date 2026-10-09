"use client";

import { DiffCodeView } from "@/features/git";
import { TerminalPreview } from "@/features/terminal";
import { ConversationMessage } from "@/features/transcript";

const MESSAGE = 'Ask the "designer" skill to fix the flaky assertion in `apps/web/studio-draft.test.ts` and match the header to `apps/web/panel.tsx` before you ship.';

const PATCH = `diff --git a/lib/theme.ts b/lib/theme.ts
--- a/lib/theme.ts
+++ b/lib/theme.ts
@@ -1,3 +1,3 @@
 export function themeId(theme: Theme) {
-  return \`theme-\${theme.id}\`; // 0O 1lI
+  return \`theme-\${theme.id.trim()}\`;
 }
`;

export function InterfacePreview() {
  return (
    <div inert className="flex flex-col">
      <ConversationMessage text={MESSAGE} />
    </div>
  );
}

export function CodePreviews() {
  return (
    <div inert className="flex min-w-0 flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <DiffCodeView patch={PATCH} layout="stacked" wrap={false} />
      </div>
      <TerminalPreview />
    </div>
  );
}
