"use client";

import { useEffect, useState } from "react";
import { TerminalIcon, ServerIcon, GlobeIcon, CircleHelpIcon, MonitorIcon, SmartphoneIcon, XIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { fmtAgo } from "@/ui/format";
import { Dropdown, Row, SettingsList } from "@/features/settings";
import type { RemoteDevice } from "@telar/engine-client";
import type { RemoteStatus } from "../api";

const KIND_ICONS: Record<string, typeof MonitorIcon> = {
  browser: GlobeIcon,
  phone: SmartphoneIcon,
  tablet: SmartphoneIcon,
  desktop: MonitorIcon,
  cli: TerminalIcon,
  service: ServerIcon,
};

function DeviceName({ device, onRename }: { device: RemoteDevice; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const kind = device.identity?.kind ?? (device.platform === "ios" ? "phone" : device.platform);
  const Icon = (kind ? KIND_ICONS[kind] : undefined) ?? CircleHelpIcon;
  const whereabouts = [device.identity?.address, device.identity?.origin ? `via ${device.identity.origin}` : undefined]
    .filter(Boolean)
    .join(" · ");

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== device.name) onRename(draft);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(device.name);
            setEditing(false);
          }
        }}
        className="h-6 w-44 px-1.5 text-xs"
      />
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0">
        <button
          type="button"
          className="cursor-text decoration-dotted underline-offset-2 hover:underline"
          title="Rename"
          onClick={() => {
            setDraft(device.name);
            setEditing(true);
          }}
        >
          {device.name}
        </button>
        {whereabouts && <span className="block truncate text-2xs font-normal text-muted-foreground">{whereabouts}</span>}
      </span>
    </span>
  );
}

function Presence({ device }: { device: RemoteDevice }) {
  if (device.connected) {
    return (
      <span className="flex items-center gap-1.5 text-foreground" title={device.lastSeenAt ? `Last request ${fmtAgo(device.lastSeenAt)}` : undefined}>
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        Connected
      </span>
    );
  }
  return <span>{device.lastSeenAt ? fmtAgo(device.lastSeenAt) : `paired ${fmtAgo(device.createdAt)}`}</span>;
}

type DeviceActions = {
  busy: boolean;
  onRename: (id: string, name: string) => void;
  onRole: (id: string, role: "full" | "observer") => void;
  onRevoke: (id: string) => void;
};

function DeviceRow({ device, busy, onRename, onRole, onRevoke }: { device: RemoteDevice } & DeviceActions) {
  const kind = device.identity?.kind ?? (device.platform === "ios" ? "phone" : device.platform);
  const kindLabel = device.platform === "ios" ? (kind === "tablet" ? "iPad" : "iPhone") : kind;
  const declaredSource = [device.identity?.client, device.identity?.machine].filter(Boolean).join(" on ");
  const source = declaredSource && !device.name.includes(declaredSource) ? declaredSource : undefined;

  return (
    <Row
      id={`settings-device-${device.id}`}
      label={<DeviceName device={device} onRename={(name) => onRename(device.id, name)} />}
      hint={
        <span className="flex flex-wrap items-center gap-x-1.5">
          {(source ?? kindLabel) && <span>{source ?? kindLabel} ·</span>}
          <Presence device={device} />
        </span>
      }
      control={
        <div className="flex items-center gap-1.5">
          <Dropdown<"full" | "observer">
            value={device.role}
            className="w-28"
            label={`What ${device.name} may do`}
            disabled={busy}
            onChange={(role) => {
              if (!busy && role !== device.role) onRole(device.id, role);
            }}
            options={[
              { value: "full", text: "Full", label: <span title="Reads and changes everything, like this app">Full</span> },
              { value: "observer", text: "View only", label: <span title="Reads everything, changes nothing">View only</span> },
            ]}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Revoke ${device.name}`}
            title="Logs this device out on its next request. Nothing on the device changes, and it can pair again."
            onClick={() => onRevoke(device.id)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      }
    />
  );
}

export function DeviceRows({ status, ...actions }: { status: RemoteStatus } & DeviceActions) {
  return (
    <>
      {!status.requireAuth && <Row label="Pairing is off" hint="These credentials only matter again when you turn pairing back on." />}
      {status.host && (
        <Row
          label={status.host.name}
          status={<Badge variant="outline">{status.host.isCaller ? "This device" : "Host"}</Badge>}
          hint="Runs the server, so it is always connected and has nothing to revoke."
        />
      )}
      {status.devices.length === 0 ? (
        <Row label="None yet" hint="Devices appear here as they pair." control={null} />
      ) : (
        <SettingsList label="Paired devices">{status.devices.map((device) => <DeviceRow key={device.id} device={device} {...actions} />)}</SettingsList>
      )}
    </>
  );
}

export function RevokeOthersRow({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const task = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(task);
  }, [armed]);
  return (
    <Row
      keywords={["sign out", "logout", "lost", "stolen"]}
      label="Revoke all other devices"
      hint="Keeps this one — the lost-phone button. Any of them can pair again with a new code."
      control={
        <Button
          variant={armed ? "destructive" : "outline"}
          size="sm"
          onClick={() => {
            if (armed) {
              setArmed(false);
              onConfirm();
            } else {
              setArmed(true);
            }
          }}
        >
          {armed ? `Revoke ${count} device${count === 1 ? "" : "s"}` : "Revoke others"}
        </Button>
      }
    />
  );
}
