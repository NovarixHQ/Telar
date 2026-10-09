"use client";

import { useCallback, useEffect, useState } from "react";
import {
  confirmForgetLogins,
  confirmProfileClear,
  confirmProfileDeletion,
  desktopBrowserProfiles,
  describeProfileUse,
  profileNameProblem,
  whyUndeletable,
  type BrowserProfile,
} from "../desktop-browser-profiles";
import { NewBrowserProfileDialog } from "../components/profile-prompt";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { ProfileColorPicker, ProfileIconPicker } from "./browser-profile-marks";
import { Row } from "@/features/settings";

type ProfilesBridge = NonNullable<ReturnType<typeof desktopBrowserProfiles>>;

function ProfileItem({
  profile,
  profiles,
  bridge,
  busy,
  error,
  renaming,
  onRenaming,
  onError,
  act,
}: {
  profile: BrowserProfile;
  profiles: BrowserProfile[];
  bridge: ProfilesBridge;
  busy: boolean;
  error: string | undefined;
  renaming: boolean;
  onRenaming: (next: boolean) => void;
  onError: (message: string) => void;
  act: (write: () => Promise<{ profiles: BrowserProfile[] }>) => void;
}) {
  const undeletable = bridge.deleteProfile ? whyUndeletable(profile) : undefined;
  return (
    <li data-profile={profile.id} className="flex items-start gap-2 border-t border-border/50 py-2">
      <ProfileIconPicker
        profile={profile.label}
        {...(profile.icon ? { icon: profile.icon } : {})}
        disabled={busy}
        onPick={(icon) => act(() => bridge.updateProfile({ profileId: profile.id, icon }))}
      />
      <ProfileColorPicker
        profile={profile.label}
        {...(profile.color ? { color: profile.color } : {})}
        disabled={busy}
        onPick={(color) => act(() => bridge.updateProfile({ profileId: profile.id, color }))}
      />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{profile.label}</span>
          {profile.isDefault && profile.label.trim().toLowerCase() !== "default" && <Badge variant="secondary">Default</Badge>}
          {profile.account && <span className="truncate font-mono text-3xs text-muted-foreground">{profile.account}</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{describeProfileUse(profile)}</p>
        {undeletable && (
          <p id={`profile-undeletable-${profile.id}`} className="text-xs leading-snug text-muted-foreground/80">
            {undeletable}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs leading-snug text-destructive">
            {error}
          </p>
        )}
        {renaming && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const label = String(new FormData(event.currentTarget).get("label") ?? "");
              const problem = profileNameProblem(label, profiles, profile.id);
              if (problem) {
                onError(problem);
                return;
              }
              onRenaming(false);
              act(() => bridge.updateProfile({ profileId: profile.id, label: label.trim() }));
            }}
          >
            <Input name="label" defaultValue={profile.label} aria-label={`Rename ${profile.label}`} className="h-7 max-w-56" />
            <Button type="submit" size="xs" variant="secondary">
              Save
            </Button>
          </form>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
        {!profile.isDefault && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            title="Every project that has not picked a profile browses here from now on. Projects already assigned somewhere are not moved."
            onClick={() => act(() => bridge.setDefaultProfile(profile.id))}
          >
            Make default
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={() => onRenaming(!renaming)}>
          {renaming ? "Done" : "Rename"}
        </Button>
        {bridge.clearProfileData && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(confirmProfileClear(profile))) return;
              act(() => bridge.clearProfileData!(profile.id));
            }}
          >
            Clear cookies and cache
          </Button>
        )}
        {bridge.forgetProfileLogins && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(confirmForgetLogins(profile))) return;
              act(() => bridge.forgetProfileLogins!(profile.id));
            }}
          >
            Forget logins
          </Button>
        )}
        {bridge.deleteProfile && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || Boolean(undeletable)}
            {...(undeletable ? { "aria-describedby": `profile-undeletable-${profile.id}` } : {})}
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (!window.confirm(confirmProfileDeletion(profile, profiles))) return;
              act(() => bridge.deleteProfile!(profile.id));
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}

export function BrowserProfilesRows() {
  const [profiles, setProfiles] = useState<BrowserProfile[]>();
  const [error, setError] = useState<{ message: string; at?: string }>();
  const [busy, setBusy] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [creating, setCreating] = useState(false);

  const bridge = desktopBrowserProfiles();

  const load = useCallback(async () => {
    const reader = desktopBrowserProfiles();
    if (!reader) return;
    try {
      setProfiles((await reader.profiles()).profiles);
      setError(undefined);
    } catch {
      setError({ message: "The desktop shell did not answer; its browser host may still be starting." });
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const act = async (id: string, write: () => Promise<{ profiles: BrowserProfile[] }>) => {
    setBusy(id);
    setError(undefined);
    try {
      setProfiles((await write()).profiles);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That change could not be made.";
      await load();
      setError({ message, at: id });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Row
      keywords={["cookies", "cache", "clear", "logins", "forget", "account", "sign in", "chrome", "profile", "default", "browser", "integrations"]}
      label="Browser profiles"
      hint="Each one is a separate set of cookies and logins for Telar's own browser."
      {...(bridge && profiles === undefined && !error ? { status: <Spinner className="size-4" /> } : {})}
      {...(error && !error.at ? { error: error.message } : {})}
      control={
        bridge ? (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            New profile
          </Button>
        ) : (
          <Badge variant="outline">Desktop app only</Badge>
        )
      }
    >
      {bridge && profiles && profiles.length > 0 && (
        <ul aria-label="Browser profiles" className="mt-2">
          {profiles.map((profile) => (
            <ProfileItem
              key={profile.id}
              profile={profile}
              profiles={profiles}
              bridge={bridge}
              busy={busy === profile.id}
              error={error?.at === profile.id ? error.message : undefined}
              renaming={renaming === profile.id}
              onRenaming={(next) => setRenaming(next ? profile.id : undefined)}
              onError={(message) => setError({ message, at: profile.id })}
              act={(write) => void act(profile.id, write)}
            />
          ))}
        </ul>
      )}
      {bridge && <NewBrowserProfileDialog open={creating} onOpenChange={setCreating} existing={profiles ?? []} onCreated={() => void load()} />}
    </Row>
  );
}
