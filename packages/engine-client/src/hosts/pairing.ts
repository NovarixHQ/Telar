export function normalizeBaseUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!url.hostname) return undefined;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
}

function looksLikePairingSecret(token: string): boolean {
  return /^tlr_[A-Za-z0-9_-]+$/.test(token) || /^\d{8}$/.test(token);
}

export function parsePairingUrl(text: string): { baseUrl: string; token: string } | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol === "telar:") {
    const link = url.hostname === "pair" ? url.searchParams.get("link") : null;
    return link && !link.startsWith("telar:") ? parsePairingUrl(link) : undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.searchParams.has("token")) return undefined;
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  const token = params.get("token");
  if (!token || !looksLikePairingSecret(token)) return undefined;
  const base = normalizeBaseUrl(url.origin);
  if (!base) return undefined;
  return { baseUrl: base, token };
}
