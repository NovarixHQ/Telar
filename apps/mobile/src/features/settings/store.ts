import type { SidebarMode } from "@telar/engine-client";

export const notificationSounds = ["hilo", "armonico", "felt", "off"] as const;
export type NotificationSound = (typeof notificationSounds)[number];
export const chatWidths = ["comfortable", "wide", "full"] as const;
export type ChatWidth = (typeof chatWidths)[number];

export type AppSettings = {
  groupBy: SidebarMode;
  chatWidth: ChatWidth;
  notifications: boolean;
  completions: boolean;
  previews: boolean;
  sound: NotificationSound;
  liveActivity: boolean;
};

/** UserDefaults keys and defaults shared with the Swift app. `groupBy` lives on each computer; this key only caches it. */
const fields: { [K in keyof AppSettings]: { key: string; fallback: AppSettings[K]; accepts: (value: unknown) => boolean } } = {
  groupBy: { key: "telar.sidebarMode", fallback: "flat", accepts: (value) => value === "grouped" || value === "flat" },
  chatWidth: { key: "telar.chatWidth", fallback: "comfortable", accepts: (value) => chatWidths.includes(value as ChatWidth) },
  notifications: { key: "telar.notifications.enabled", fallback: false, accepts: isBoolean },
  completions: { key: "telar.notifications.completions", fallback: true, accepts: isBoolean },
  previews: { key: "telar.notifications.previews", fallback: false, accepts: isBoolean },
  sound: { key: "telar.notifications.sounds", fallback: "hilo", accepts: (value) => notificationSounds.includes(value as NotificationSound) },
  liveActivity: { key: "telar.activities.enabled", fallback: true, accepts: isBoolean },
};

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean" || value === 0 || value === 1;
}

export type Backend = { get(key: string): unknown; set(values: Record<string, unknown>): void };

export class SettingsStore {
  private snapshot: AppSettings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly backend: Backend) {
    this.snapshot = this.read();
  }

  get current(): AppSettings {
    return this.snapshot;
  }

  set<K extends keyof AppSettings>(name: K, value: AppSettings[K]): void {
    if (this.snapshot[name] === value) return;
    this.backend.set({ [fields[name].key]: value });
    this.snapshot = { ...this.snapshot, [name]: value };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private read(): AppSettings {
    const entries = Object.entries(fields).map(([name, field]) => {
      const stored = this.backend.get(field.key);
      if (!field.accepts(stored)) return [name, field.fallback];
      return [name, typeof field.fallback === "boolean" ? Boolean(stored) : stored];
    });
    return Object.fromEntries(entries) as AppSettings;
  }
}

export function notificationsSummary({ notifications, liveActivity }: Pick<AppSettings, "notifications" | "liveActivity">): string {
  const alerts = notifications ? "On" : "Off";
  return liveActivity ? `${alerts} · Live Activity on` : alerts;
}

export const soundLabel: Record<NotificationSound, string> = { hilo: "Hilo", armonico: "Armónico", felt: "Felt", off: "Off" };
export const chatWidthLabel: Record<ChatWidth, string> = { comfortable: "Comfortable", wide: "Wide", full: "Full" };
export const groupByLabel: Record<SidebarMode, string> = { grouped: "Project", flat: "None" };
