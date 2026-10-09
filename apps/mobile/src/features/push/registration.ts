import type { RelayCredential, RelayTokens } from "./relay";

/** The body of `PUT api/mobile/push`, the same one the Swift app sends. */
export type PushRegistration = {
  hostId: string;
  token: string;
  topic: string;
  sandbox: boolean;
  enabled: boolean;
  completions: boolean;
  previews: boolean;
  sounds: string;
  mutedSessions: string[];
  liveActivities: boolean;
  hostName: string;
  relay?: RelayCredential;
  relayCard: true;
  simulator?: true;
};

export type PushHost = { hostId: string; name: string; register(body: PushRegistration): Promise<{ configured?: boolean }> };
export type PushPrefs = { notifications: boolean; completions: boolean; previews: boolean; sound: string; liveActivity: boolean };

export type PushSyncDeps = {
  topic: string;
  sandbox: boolean;
  simulator: boolean;
  hosts(): PushHost[];
  prefs(): PushPrefs;
  /** The sessions this host must not alert about. */
  muted(hostId: string): string[];
  allowed(): Promise<boolean>;
  /** Whether this phone can show a Live Activity, and the running card's push token if there is one. */
  card(): { enabled: boolean; token?: string };
  credential(hostId: string, tokens: RelayTokens): Promise<RelayCredential | undefined>;
  revoke(hostId: string): Promise<void>;
  onResult?(hostId: string, configured: boolean | undefined): void;
};

/** Keeps every paired computer told where to push this phone. One sync runs at a time; calls during it fold into one more. */
export class PushSync {
  private token: string | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private known = new Set<string>();

  constructor(private readonly deps: PushSyncDeps) {}

  setToken(token: string): Promise<void> {
    if (token === this.token) return this.running ?? Promise.resolve();
    this.token = token;
    return this.sync();
  }

  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.once();
      } while (this.again);
      this.running = undefined;
    })();
    return this.running;
  }

  private async once(): Promise<void> {
    const hosts = this.deps.hosts();
    const paired = new Set(hosts.map((host) => host.hostId));
    const gone = [...this.known].filter((id) => !paired.has(id));
    this.known = paired;
    await Promise.all(gone.map((id) => this.deps.revoke(id).catch(() => undefined)));
    const token = this.token;
    if (!token) return;
    const prefs = this.deps.prefs();
    const enabled = prefs.notifications && (await this.deps.allowed());
    const card = this.deps.card();
    const tokens: RelayTokens = { token, ...(card.token ? { card: card.token } : {}) };
    await Promise.all(hosts.map(async (host) => {
      const relay = this.deps.simulator ? undefined : await this.deps.credential(host.hostId, tokens);
      const body: PushRegistration = {
        hostId: host.hostId,
        token,
        topic: this.deps.topic,
        sandbox: this.deps.sandbox,
        enabled,
        completions: prefs.completions,
        previews: prefs.previews,
        sounds: prefs.sound,
        mutedSessions: this.deps.muted(host.hostId),
        liveActivities: prefs.liveActivity && card.enabled,
        hostName: host.name,
        ...(relay ? { relay } : {}),
        relayCard: true,
        ...(this.deps.simulator ? { simulator: true as const } : {}),
      };
      const reply = await host.register(body).catch(() => undefined);
      this.deps.onResult?.(host.hostId, reply?.configured);
    }));
  }
}
