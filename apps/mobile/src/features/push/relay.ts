export type RelayCredential = { url: string; handle: string; keyId: string; sendKey: string };
type Key = { keyId: string; sendKey: string };
/** The phone's APNs token and, while one runs, the Live Activity card's own push token. */
export type RelayTokens = { token: string; card?: string };
export type RelayState = { attestKeyId?: string; handle?: string; registered?: RelayTokens; refreshedAt?: number; keys: Record<string, Key> };

/** App Attest as the native module exposes it: each challenge is hashed with SHA-256 before it is signed. */
export type Attest = {
  isSupported: boolean;
  generateKey(): Promise<string>;
  attestKey(keyId: string, challenge: string): Promise<string>;
  generateAssertion(keyId: string, challenge: string): Promise<string>;
};

export type RelayDeps = {
  url: string;
  bundle: string;
  sandbox: boolean;
  attest: Attest;
  fetch(url: string, init: RequestInit): Promise<Response>;
  load(): Promise<RelayState | undefined>;
  save(state: RelayState): Promise<void>;
  now?: () => number;
};

export const RELAY_URL = "https://telar-push-relay.facundo-barbera.workers.dev";
const BUNDLES = new Set(["io.github.novarix.telar", "io.github.novarix.telar.dev"]);
const REFRESH_MS = 86_400_000;
const UNSUPPORTED = "ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED";

class RelayError extends Error {
  constructor(readonly status: number) {
    super(`relay answered ${status}`);
  }
}
class AttestationRefused extends Error {}

/** The phone's side of the push relay: one attested registration per install, and a send key per paired computer. */
export class PushRelay {
  private state: Promise<RelayState>;
  private refused = false;
  private readonly now: () => number;

  constructor(private readonly deps: RelayDeps) {
    this.now = deps.now ?? Date.now;
    this.state = deps.load().then((stored) => stored ?? { keys: {} }, () => ({ keys: {} }));
  }

  get unavailable(): boolean {
    return this.refused || !this.deps.attest.isSupported || !BUNDLES.has(this.deps.bundle);
  }

  async credential(host: string, tokens: RelayTokens): Promise<RelayCredential | undefined> {
    if (this.unavailable) return undefined;
    try {
      await this.synchronize(tokens);
      return await this.key(host);
    } catch (error) {
      if (error instanceof AttestationRefused || (error as { code?: unknown } | null)?.code === UNSUPPORTED) this.refused = true;
      return undefined;
    }
  }

  async revoke(host: string): Promise<void> {
    const state = await this.state;
    const key = state.keys[host];
    if (!key) return;
    delete state.keys[host];
    await this.deps.save(state);
    if (state.handle) await this.signed("DELETE", `/v2/devices/${state.handle}/keys/${key.keyId}`).catch(() => undefined);
  }

  private async synchronize(tokens: RelayTokens): Promise<void> {
    const state = await this.state;
    if (!state.handle) return this.register(tokens);
    const same = state.registered?.token === tokens.token && state.registered.card === tokens.card;
    if (same && state.refreshedAt !== undefined && this.now() - state.refreshedAt < REFRESH_MS) return;
    const { status } = await this.signed("PUT", `/v2/devices/${state.handle}`, JSON.stringify(tokens));
    if (status === 401 || status === 404 || status === 410) return this.register(tokens);
    if (status !== 200) throw new RelayError(status);
    state.registered = tokens;
    state.refreshedAt = this.now();
    await this.deps.save(state);
  }

  private async register(tokens: RelayTokens): Promise<void> {
    const asked = await this.request("GET", "/v2/challenge");
    const challenge = asked.status === 200 ? (asked.body as { challenge?: unknown }).challenge : undefined;
    if (typeof challenge !== "string") throw new RelayError(asked.status);
    const keyId = await this.deps.attest.generateKey();
    const attestation = await this.deps.attest.attestKey(keyId, challenge);
    const body = JSON.stringify({ keyId, attestation, challenge, bundle: this.deps.bundle, sandbox: this.deps.sandbox, ...tokens });
    const created = await this.request("POST", "/v2/devices", body);
    if (created.status === 401) throw new AttestationRefused();
    const handle = created.status === 201 ? (created.body as { handle?: unknown }).handle : undefined;
    if (typeof handle !== "string") throw new RelayError(created.status);
    const fresh: RelayState = { attestKeyId: keyId, handle, registered: tokens, refreshedAt: this.now(), keys: {} };
    this.state = Promise.resolve(fresh);
    await this.deps.save(fresh);
  }

  private async key(host: string): Promise<RelayCredential> {
    const state = await this.state;
    if (!state.handle) throw new RelayError(0);
    const known = state.keys[host];
    if (known) return { url: this.deps.url, handle: state.handle, ...known };
    const minted = await this.signed("POST", `/v2/devices/${state.handle}/keys`, JSON.stringify({ pairing: host }));
    const key = minted.body as Partial<Key> | undefined;
    if (minted.status !== 201 || typeof key?.keyId !== "string" || typeof key.sendKey !== "string") throw new RelayError(minted.status);
    state.keys[host] = { keyId: key.keyId, sendKey: key.sendKey };
    await this.deps.save(state);
    return { url: this.deps.url, handle: state.handle, keyId: key.keyId, sendKey: key.sendKey };
  }

  /** The relay checks an assertion over `"<METHOD> <path>\n<body>"`. */
  private async signed(method: string, path: string, body = "") {
    const { attestKeyId } = await this.state;
    if (!attestKeyId) throw new RelayError(0);
    const assertion = await this.deps.attest.generateAssertion(attestKeyId, `${method} ${path}\n${body}`);
    return this.request(method, path, body || undefined, assertion);
  }

  private async request(method: string, path: string, body?: string, assertion?: string): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {};
    if (body) headers["content-type"] = "application/json";
    if (assertion) headers["x-telar-assertion"] = assertion;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await this.deps.fetch(`${this.deps.url}${path}`, { method, headers, ...(body ? { body } : {}), signal: abort.signal });
      return { status: response.status, body: await response.json().catch(() => undefined) };
    } finally {
      clearTimeout(timer);
    }
  }
}
