"use client";

import { useLinkPolicy } from "@/platform/link-policy";
import { Switch } from "@/ui/switch";
import { Row, useRestoreDefaults } from "@/features/settings";

export function LinksRow() {
  const { openInSessionBrowser, setOpenInSessionBrowser } = useLinkPolicy();
  useRestoreDefaults(() => setOpenInSessionBrowser(false));

  return (
    <Row
      keywords={["external", "system browser", "tabs", "links"]}
      label="Open in the session's browser"
      hint={
        openInSessionBrowser
          ? "Issues and pull requests open in the right panel; other links become tabs the agent can see."
          : "Links open in your system browser."
      }
      info="Kept in this browser only. A paired phone or another computer keeps its own."
      {...(openInSessionBrowser ? { onRevert: () => setOpenInSessionBrowser(false) } : {})}
      control={
        <Switch
          checked={openInSessionBrowser}
          onCheckedChange={setOpenInSessionBrowser}
          aria-label="Open links in the session's browser"
        />
      }
    />
  );
}
