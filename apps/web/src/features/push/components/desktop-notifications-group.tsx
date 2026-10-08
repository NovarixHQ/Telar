"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/ui/badge";
import { Switch } from "@/ui/switch";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";

type NotificationsBridge = {
  get: () => Promise<{ enabled: boolean }>;
  set: (enabled: boolean) => Promise<{ enabled: boolean }>;
};

function desktopNotifications(): NotificationsBridge | undefined {
  const bridge = (window as { telarDesktop?: { notifications?: Partial<NotificationsBridge> } }).telarDesktop?.notifications;
  return bridge?.get && bridge.set ? (bridge as NotificationsBridge) : undefined;
}

export function DesktopNotificationsGroup() {
  const [bridge, setBridge] = useState<NotificationsBridge | null>();
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const found = desktopNotifications() ?? null;
    const task = window.setTimeout(() => setBridge(found), 0);
    void found?.get().then(({ enabled }) => setEnabled(enabled), () => setEnabled(true));
    return () => window.clearTimeout(task);
  }, []);

  const save = async (next: boolean) => {
    if (!bridge) return;
    const before = enabled;
    setEnabled(next);
    setError(undefined);
    try {
      setEnabled((await bridge.set(next)).enabled);
    } catch {
      setEnabled(before);
      setError("Couldn't save. Try again.");
    }
  };

  useRestoreDefaults(() => save(true));

  return (
    <SettingsGroup title="Notifications" scope="mac">
      <Row
        keywords={["alerts", "banner", "desktop notifications", "notify", "sound", "finished", "failed", "approval"]}
        label="Desktop notifications"
        hint="A banner when a session finishes, fails, or needs your input or approval."
        info="Your phone decides its own notifications, in the Telar app."
        {...(error ? { error } : {})}
        {...(enabled === false ? { onRevert: () => void save(true) } : {})}
        control={
          bridge === null ? (
            <Badge variant="outline">Desktop app only</Badge>
          ) : (
            <Switch aria-label="Desktop notifications" checked={enabled ?? true} disabled={enabled === undefined} onCheckedChange={(next: boolean) => void save(next)} />
          )
        }
      />
    </SettingsGroup>
  );
}
