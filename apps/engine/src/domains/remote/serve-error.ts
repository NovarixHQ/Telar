const KNOWN = ["no-cert-domain", "https-disabled", "not-installed", "not-logged-in", "permission-denied", "unknown"] as const;

export type TailscaleServeError = (typeof KNOWN)[number];

export function readServeError(env: Record<string, string | undefined> = process.env): TailscaleServeError | undefined {
  const raw = env.TELAR_TAILSCALE_SERVE_ERROR?.trim();
  if (!raw) return undefined;
  return (KNOWN as readonly string[]).includes(raw) ? (raw as TailscaleServeError) : "unknown";
}
