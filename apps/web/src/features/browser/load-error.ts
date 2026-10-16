export type PageLoadError = { code: string; url: string };

function hostOf(url: string): { host: string; hostname: string } {
  try {
    const parsed = new URL(url);
    if (parsed.host) return { host: parsed.host, hostname: parsed.hostname };
  } catch {}
  return { host: url || "This page", hostname: url || "This page" };
}

function reasonFor(code: string, host: string, hostname: string): string {
  if (code === "ERR_CONNECTION_REFUSED") return `Nothing is listening on ${host}.`;
  if (code === "ERR_NAME_NOT_RESOLVED" || code === "ERR_NAME_RESOLUTION_FAILED") return `No server could be found at ${hostname}.`;
  if (code === "ERR_CONNECTION_TIMED_OUT" || code === "ERR_TIMED_OUT") return `${host} took too long to respond.`;
  if (code === "ERR_INTERNET_DISCONNECTED" || code === "ERR_NETWORK_CHANGED") return "This computer is not connected to the internet.";
  if (code.startsWith("ERR_CERT_") || code.startsWith("ERR_SSL_")) return `${host} did not offer a secure connection that could be trusted.`;
  return `The page could not be loaded (${code}).`;
}

export function describeLoadError({ code, url }: PageLoadError) {
  const { host, hostname } = hostOf(url);
  if (code === "ERR_RENDERER_GONE") return { title: "This page crashed", host, reason: "It stopped twice in a minute, so it was not reloaded again." };
  return { title: "Can’t reach this page", host, reason: reasonFor(code, host, hostname) };
}

const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.replace(REMOTE_PREFIX, "") || fallback : fallback;
}
