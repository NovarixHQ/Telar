"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import type { SimulatorAction, SimulatorConfiguration, SimulatorDetail, SimulatorPermission, SimulatorSummary, SimulatorToggle } from "@telar/engine-client";
import { Dropdown, Segmented } from "@/features/settings";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import type { SimulatorsApi } from "../api";

const TEXT_SIZES = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "extra-large", label: "Extra large" },
] as const;
const COLOR_FILTERS = [
  { value: "none", label: "None" },
  { value: "grayscale", label: "Grayscale" },
  { value: "red-green", label: "Red / green" },
  { value: "green-red", label: "Green / red" },
  { value: "blue-yellow", label: "Blue / yellow" },
] as const;
const ORIENTATIONS = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape_left", label: "Left" },
  { value: "portrait_upside_down", label: "Upside down" },
  { value: "landscape_right", label: "Right" },
] as const;
const TOGGLES: Record<"ios" | "android", Array<{ setting: SimulatorToggle; label: string }>> = {
  ios: [
    { setting: "reduceMotion", label: "Reduce motion" },
    { setting: "increaseContrast", label: "Increase contrast" },
    { setting: "reduceTransparency", label: "Reduce transparency" },
    { setting: "showBorders", label: "Show borders" },
    { setting: "voiceOver", label: "Screen reader" },
  ],
  android: [
    { setting: "reduceMotion", label: "Reduce motion" },
    { setting: "networkEnabled", label: "Network" },
  ],
};
const PERMISSIONS: Record<"ios" | "android", SimulatorPermission[]> = {
  ios: ["camera", "microphone", "photos", "contacts", "calendar", "reminders", "location", "notifications", "motion", "media-library", "faceid"],
  android: ["camera", "microphone", "photos", "contacts", "calendar", "location", "notifications", "motion"],
};
const PERMISSION_LABELS: Record<SimulatorPermission, string> = {
  camera: "Camera", microphone: "Microphone", photos: "Photos", contacts: "Contacts", calendar: "Calendar", reminders: "Reminders",
  location: "Location", notifications: "Notifications", motion: "Motion", "media-library": "Media library", faceid: "Face unlock",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-border px-3 py-3">
      <h3 className="font-mono text-3xs tracking-[0.08em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      {children}
    </div>
  );
}

type SettingsProps = { simulator: SimulatorSummary; api: SimulatorsApi; visible: boolean; onClose: () => void };

export function SimulatorSettings({ simulator, api, visible, onClose }: SettingsProps) {
  const [detail, setDetail] = useState<SimulatorDetail>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [appId, setAppId] = useState("");
  const [link, setLink] = useState("");
  const [place, setPlace] = useState({ latitude: "", longitude: "" });
  const [permission, setPermission] = useState<SimulatorPermission>("camera");
  const [alert, setAlert] = useState("");
  const busy = useRef(false);
  const platform = simulator.platform;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void api
      .simulatorDetail(simulator.id)
      .then(({ detail: read }) => !cancelled && setDetail(read))
      .catch((cause: unknown) => !cancelled && setError(cause instanceof Error ? cause.message : "The settings could not be read."));
    return () => {
      cancelled = true;
    };
  }, [api, simulator.id, visible]);

  const act = useCallback(
    async (action: SimulatorAction) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      try {
        setDetail((await api.simulatorAction(simulator.id, action)).detail);
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The simulator refused that change.");
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [api, simulator.id],
  );

  const app = appId.trim() || detail?.foregroundApp?.id || "";
  const configuration: SimulatorConfiguration = detail?.configuration ?? {};
  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  const placeValid = place.latitude.trim() !== "" && place.longitude.trim() !== "" && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

  return (
    <aside aria-label="Simulator settings" className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs font-medium">
        Settings
        {pending && <Spinner />}
        <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Close settings" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {error && <p role="alert" className="px-3 py-2 text-2xs text-destructive">{error}</p>}
      {!detail && !error ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">Reading settings…</p>
      ) : (
        <>
          <Section title="Display">
            <Line label="Appearance">
              <Segmented value={configuration.appearance ?? ""} onChange={(value) => void act({ type: "setAppearance", value: value as "light" | "dark" })} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
            </Line>
            <Line label="Text size">
              <Dropdown label="Text size" className="w-32" value={configuration.textSize ?? "default"} onChange={(value) => void act({ type: "setTextSize", value })} options={[...TEXT_SIZES]} />
            </Line>
            {platform === "ios" ? (
              <>
                <Line label="Glass style">
                  <Segmented value={configuration.liquidGlass ?? ""} onChange={(value) => void act({ type: "setLiquidGlass", value: value as "clear" | "tinted" })} options={[{ value: "clear", label: "Clear" }, { value: "tinted", label: "Tinted" }]} />
                </Line>
                <Line label="Color filter">
                  <Dropdown label="Color filter" className="w-32" value={configuration.colorFilter ?? "none"} onChange={(value) => void act({ type: "setColorFilter", value })} options={[...COLOR_FILTERS]} />
                </Line>
              </>
            ) : (
              <Line label="Orientation">
                <Dropdown label="Orientation" className="w-32" value="portrait" onChange={(value) => void act({ type: "setOrientation", value })} options={[...ORIENTATIONS]} />
              </Line>
            )}
            {TOGGLES[platform].map(({ setting, label }) => (
              <Line key={setting} label={label}>
                <Switch aria-label={label} checked={configuration[setting] === true} disabled={configuration[setting] === undefined || pending} onCheckedChange={(value: boolean) => void act({ type: "setToggle", setting, value })} />
              </Line>
            ))}
          </Section>
          <Section title="Apps">
            <Input aria-label="App ID" placeholder={detail?.foregroundApp?.id ?? "App ID"} value={appId} onChange={(event) => setAppId(event.target.value)} />
            <div className="flex gap-1">
              <Button size="xs" variant="outline" disabled={!app} onClick={() => void act({ type: "launchApp", appId: app })}>Launch</Button>
              <Button size="xs" variant="outline" disabled={!app} onClick={() => void act({ type: "terminateApp", appId: app })}>Quit</Button>
            </div>
            <div className="flex gap-1">
              <Input aria-label="Link" placeholder="https://… or app://" value={link} onChange={(event) => setLink(event.target.value)} />
              <Button size="xs" variant="outline" disabled={!link.trim()} onClick={() => void act({ type: "openUrl", url: link.trim() })}>Open</Button>
            </div>
          </Section>
          <Section title="Permissions">
            <Dropdown label="Permission" className="w-full" value={permission} onChange={setPermission} options={PERMISSIONS[platform].map((value) => ({ value, label: PERMISSION_LABELS[value] }))} />
            <div className="flex gap-1">
              {(platform === "ios" ? (["grant", "revoke", "reset"] as const) : (["grant", "revoke"] as const)).map((decision) => (
                <Button key={decision} size="xs" variant="outline" disabled={!app} onClick={() => void act({ type: "setPermission", appId: app, permission, decision })}>
                  {decision === "grant" ? "Grant" : decision === "revoke" ? "Revoke" : "Reset"}
                </Button>
              ))}
            </div>
          </Section>
          <Section title="Location">
            <div className="flex gap-1">
              <Input aria-label="Latitude" inputMode="decimal" placeholder="Latitude" value={place.latitude} onChange={(event) => setPlace({ ...place, latitude: event.target.value })} />
              <Input aria-label="Longitude" inputMode="decimal" placeholder="Longitude" value={place.longitude} onChange={(event) => setPlace({ ...place, longitude: event.target.value })} />
            </div>
            <div className="flex gap-1">
              <Button size="xs" variant="outline" disabled={!placeValid} onClick={() => void act({ type: "setLocation", latitude, longitude })}>Set</Button>
              {platform === "ios" && <Button size="xs" variant="outline" onClick={() => void act({ type: "clearLocation" })}>Clear</Button>}
            </div>
          </Section>
          {platform === "ios" && (
            <Section title="Notification">
              <div className="flex gap-1">
                <Input aria-label="Alert text" placeholder="Alert text" value={alert} onChange={(event) => setAlert(event.target.value)} />
                <Button size="xs" variant="outline" disabled={!app || !alert.trim()} onClick={() => void act({ type: "sendPush", appId: app, payload: alert.trim() })}>Send</Button>
              </div>
            </Section>
          )}
        </>
      )}
    </aside>
  );
}
