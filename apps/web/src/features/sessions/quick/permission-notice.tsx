"use client";

import { useState } from "react";
import { CheckIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@/ui/button";
import type { FrontContext, Permission, QuickComposerBridge } from "./front-context";

const SKIPPED_KEY = "telar.quick-composer.permissions-skipped";

const PERMISSIONS: readonly { key: Permission; label: string; use: string; info?: string }[] = [
  { key: "screen", label: "Screen Recording", use: "attaches the window in front", info: "macOS may apply it only after a restart." },
  { key: "accessibility", label: "Accessibility", use: "attaches your selected text" },
];

export function PermissionNotice({ bridge, context }: { bridge: QuickComposerBridge; context: FrontContext }) {
  const [skipped, setSkipped] = useState(() => window.localStorage.getItem(SKIPPED_KEY) === "1");
  if (skipped) return null;
  const skip = () => {
    window.localStorage.setItem(SKIPPED_KEY, "1");
    setSkipped(true);
  };
  return (
    <div role="note" className="mx-4 flex flex-col gap-1 rounded-xl border border-border/80 bg-popover p-2 pl-3 text-xs text-popover-foreground shadow-2">
      <div className="flex items-center gap-2">
        <ShieldAlertIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate">Allow “{context.grantee}” to attach what you’re looking at. The composer works without it.</p>
        <Button size="xs" variant="ghost" onClick={skip}>Skip</Button>
      </div>
      <ul className="flex flex-col">
        {PERMISSIONS.map(({ key, label, use, info }) => (
          <li key={key} data-permission={key} className="flex h-7 items-center gap-2 pl-6">
            <span className="font-medium" {...(info ? { title: info } : {})}>{label}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{use}</span>
            {context.permissions[key] ? (
              <span className="flex items-center gap-1 pr-2 text-muted-foreground">
                Granted <CheckIcon className="size-3.5" />
              </span>
            ) : (
              <Button size="xs" variant="outline" onClick={() => void bridge.openSettings(key)}>Open Settings</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
