"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DownloadIcon, MonitorIcon, PowerIcon, RefreshCwIcon } from "lucide-react";
import { CHANNEL_HINT, desktopUpdates, updateStatusHint, useDesktopUpdate, type UpdatePrefsInfo } from "../desktop-updates";
import { Row, SettingsGroup } from "@/features/settings";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { UpdateToast } from "./update-toast";
import { RestartUpdateDialog } from "./restart-update-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>;
}

function VersionRow({ appVersion }: { appVersion?: string }) {
  return <Row keywords={["about", "this build"]} label="Version" control={<Mono>{appVersion ?? "—"}</Mono>} />;
}

export function AboutSection({ appVersion }: { appVersion?: string }) {
  const { supported: isDesktop, status, action, label, busy, failure, act, restart } = useDesktopUpdate();
  const [prefs, setPrefs] = useState<UpdatePrefsInfo | null>(null);

  useEffect(() => {
    const updates = desktopUpdates();
    if (!updates) return;
    void updates.getPrefs().then(setPrefs);
  }, []);

  const savePrefs = async (patch: Partial<UpdatePrefsInfo>) => {
    setPrefs((current) => (current ? { ...current, ...patch } : current));
    const saved = await desktopUpdates()?.setPrefs(patch);
    if (saved) setPrefs((current) => (current ? { ...current, ...saved } : current));
  };

  if (!isDesktop) {
    return (
      <SettingsGroup title="About">
        <VersionRow {...(appVersion ? { appVersion } : {})} />
        <Row icon={MonitorIcon} label="Desktop app only" hint="Only the desktop app updates itself." />
      </SettingsGroup>
    );
  }

  const control = (
    <span data-slot="update-control" className="relative inline-flex items-center">
      <UpdateToast status={status} />
      <RestartUpdateDialog restart={restart} />
      {action === "restarting" ? (
        <Button size="sm" disabled aria-label={label}>
          <Spinner /> Restarting…
        </Button>
      ) : action === "apply" ? (
        <Button size="sm" onClick={act} aria-label={label}>
          <PowerIcon /> Install &amp; restart
        </Button>
      ) : action === "download" ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-label={label}>
          <DownloadIcon className="size-4" />
          {status.status === "downloading" ? `Downloading… ${Math.round(status.percent ?? 0)}%` : "Downloading…"}
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={act} disabled={busy} aria-label={label}>
          {status.status === "checking" ? <Spinner /> : <RefreshCwIcon />} Check for updates
        </Button>
      )}
    </span>
  );

  if (prefs && !prefs.configured) {
    return (
      <SettingsGroup title="About">
        <VersionRow {...(appVersion ? { appVersion } : {})} />
        <Row
          icon={MonitorIcon}
          keywords={["upgrade", "download", "updates", "channel"]}
          label="No update feed in this build"
          hint="It was packaged locally, so it never checks for or installs updates."
        />
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title="About">
      <VersionRow {...(appVersion ? { appVersion } : {})} />
      <Row keywords={["upgrade", "download", "version", "updates"]} label="Update status" hint={failure ?? updateStatusHint(status)} control={control} />
      <Row
        keywords={["beta", "nightly", "stable", "release", "updates"]}
        label="Channel"
        {...(prefs && CHANNEL_HINT[prefs.channel] ? { hint: CHANNEL_HINT[prefs.channel] } : {})}
        control={
          <Select
            value={prefs?.channel ?? "beta"}
            onValueChange={(channel) => {
              if (typeof channel === "string") void savePrefs({ channel });
            }}
            disabled={!prefs}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(prefs?.channels ?? ["beta"]).map((channel) => (
                <SelectItem key={channel} value={channel}>
                  {channel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroup>
  );
}
