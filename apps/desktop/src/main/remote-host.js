const fs = require("node:fs");
const path = require("node:path");

const FILE = "remote-host.json";
const EXCHANGE_TIMEOUT_MS = 8_000;

function baseOf(raw) {
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return undefined;
    return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return undefined;
  }
}

function parsePairingLink(text) {
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol === "telar:") {
    const link = url.hostname === "pair" ? url.searchParams.get("link") : null;
    return link && !link.startsWith("telar:") ? parsePairingLink(link) : undefined;
  }
  if (url.searchParams.has("token")) return undefined;
  const code = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
  const baseUrl = baseOf(url.origin);
  return baseUrl && code && (/^tlr_[A-Za-z0-9_-]+$/.test(code) || /^\d{8}$/.test(code)) ? { baseUrl, code } : undefined;
}

async function exchange(baseUrl, code, deviceName, fetchImpl) {
  const refusal = "The other computer did not answer. Check that it is reachable from here and that its Telar is serving.";
  let paired;
  try {
    const answer = await fetchImpl(`${baseUrl}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: code, deviceName, kind: "desktop", client: "Telar", os: process.platform === "darwin" ? "macOS" : process.platform }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    const payload = await answer.json().catch(() => null);
    if (!answer.ok || typeof payload?.deviceToken !== "string") {
      throw new Error(payload?.error?.message ?? `The other computer refused the pairing (status ${answer.status}).`);
    }
    paired = payload.deviceToken;
  } catch (error) {
    throw error?.name === "TimeoutError" || error instanceof TypeError ? new Error(refusal) : error;
  }
  const health = await fetchImpl(`${baseUrl}/api/health`, { headers: { authorization: `Bearer ${paired}` }, signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS) })
    .then((answer) => answer.json())
    .catch(() => null);
  return { deviceToken: paired, name: typeof health?.hostname === "string" ? health.hostname.trim() : "" };
}

function createRemoteHost({ dir, fetchImpl = fetch }) {
  const file = path.join(dir, FILE);
  let cached;

  function read() {
    if (cached) return cached;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const remote = data?.remote;
      const valid = remote && typeof remote.baseUrl === "string" && typeof remote.deviceToken === "string" && remote.deviceToken !== "";
      cached = { local: data?.local !== false || !valid, remote: valid ? { baseUrl: remote.baseUrl, deviceToken: remote.deviceToken, name: String(remote.name ?? "") } : null };
    } catch {
      cached = { local: true, remote: null };
    }
    return cached;
  }

  function write(next) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, file);
    cached = next;
    return next;
  }

  const publicMode = () => {
    const { local, remote } = read();
    return { local, remote: remote ? { baseUrl: remote.baseUrl, name: remote.name } : null };
  };

  return {
    mode: read,
    publicMode,
    endpoint() {
      const { local, remote } = read();
      return !local && remote ? { baseUrl: remote.baseUrl, token: remote.deviceToken } : null;
    },
    async connect(link, deviceName) {
      const parsed = typeof link === "string" ? parsePairingLink(link) : undefined;
      if (!parsed) throw new Error("Paste the pairing link from the other computer (it ends in #token= and the eight-digit code).");
      const paired = await exchange(parsed.baseUrl, parsed.code, deviceName, fetchImpl);
      write({ local: false, remote: { baseUrl: parsed.baseUrl, deviceToken: paired.deviceToken, name: paired.name || new URL(parsed.baseUrl).hostname } });
      return publicMode();
    },
    useLocal(on) {
      const { remote } = read();
      write({ local: on || !remote, remote });
      return publicMode();
    },
    forget() {
      write({ local: true, remote: null });
      return publicMode();
    },
  };
}

module.exports = { createRemoteHost, parsePairingLink };
