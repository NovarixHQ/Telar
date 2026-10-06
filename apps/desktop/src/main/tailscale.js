const { execFile } = require("node:child_process");
const remoteFile = require("./remote-file");

const STATUS_TIMEOUT_MS = 1_500;
const SERVE_TIMEOUT_MS = 10_000;

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile("tailscale", args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        spawnFailed: Boolean(error && (error.code === "ENOENT" || error.code === "ENOTDIR")),
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

async function certDomain(exec) {
  const result = await exec(["status", "--json"], STATUS_TIMEOUT_MS);
  if (!result.ok) return null;
  try {
    const raw = JSON.parse(result.stdout);
    const domains = Array.isArray(raw?.CertDomains) ? raw.CertDomains.filter((d) => typeof d === "string" && d) : [];
    return domains[0] ?? null;
  } catch {
    return null;
  }
}

function classify(stderr, exitCode) {
  const text = String(stderr ?? "");
  if (/https.{0,30}(is not|not) enabled|cert.{0,40}disabled|enable https/i.test(text)) return "https-disabled";
  if (/not logged in|logged out|needs? login/i.test(text)) return "not-logged-in";
  if (/permission denied|access denied|must be root|operation not permitted/i.test(text)) return "permission-denied";
  return exitCode === 0 ? "none" : "unknown";
}

function failure(result) {
  if (result.spawnFailed) return "not-installed";
  return classify(result.stderr, result.exitCode);
}

const FALLBACK_PORTS = Array.from({ length: 10 }, (_, i) => 4443 + i);

async function serveStatus(exec) {
  const result = await exec(["serve", "status", "--json"], STATUS_TIMEOUT_MS);
  if (!result.ok) return { error: failure(result) };
  try {
    const raw = JSON.parse(result.stdout.trim() || "{}");
    return { configs: [raw, ...Object.values(raw?.Foreground ?? {})].filter((c) => c && typeof c === "object") };
  } catch {
    return { error: "unknown" };
  }
}

function proxiesTo(configs, servePort, uiPort) {
  return configs.some((config) =>
    Object.entries(config.Web ?? {}).some(([hostPort, web]) => {
      if (!hostPort.endsWith(`:${servePort}`)) return false;
      return Object.values(web?.Handlers ?? {}).some((handler) => {
        try {
          const target = new URL(handler?.Proxy);
          return ["127.0.0.1", "localhost"].includes(target.hostname) && Number(target.port) === uiPort;
        } catch {
          return false;
        }
      });
    }),
  );
}

const inUse = (configs, servePort) => configs.some((config) => config.TCP?.[String(servePort)] !== undefined);

function choosePort(configs, uiPort) {
  return [443, ...FALLBACK_PORTS].find((p) => !inUse(configs, p) || proxiesTo(configs, p, uiPort)) ?? null;
}

let tailscaleServeUrl = null;
let tailscaleServeError = null;
let published = null;

function fail(error) {
  tailscaleServeError = error;
  console.error(`[telar-desktop] tailscale serve failed (${error}); the ts.net endpoint is down.`);
  return null;
}

async function publishTailscaleServe(home, uiPort, exec = run) {
  tailscaleServeError = null;
  if (!remoteFile.tailscaleServeRequested(home)) return null;
  const domain = await certDomain(exec);
  if (!domain) {
    tailscaleServeError = "no-cert-domain";
    console.error("[telar-desktop] tailscale serve requested but tailscale is missing, not running, or has HTTPS certificates disabled; skipped.");
    return null;
  }
  const status = await serveStatus(exec);
  if (status.error) return fail(status.error);
  const servePort = choosePort(status.configs, uiPort);
  if (servePort === null) return fail("unknown");
  const result = await exec(["serve", "--bg", `--https=${servePort}`, `http://127.0.0.1:${uiPort}`], SERVE_TIMEOUT_MS);
  if (!result.ok) return fail(failure(result));
  published = { servePort, uiPort };
  tailscaleServeUrl = servePort === 443 ? `https://${domain}` : `https://${domain}:${servePort}`;
  console.log(`[telar-desktop] tailnet: ${tailscaleServeUrl}/`);
  return tailscaleServeUrl;
}

function serveEnv() {
  return {
    ...(tailscaleServeUrl ? { TELAR_TAILSCALE_URL: tailscaleServeUrl } : {}),
    ...(tailscaleServeError ? { TELAR_TAILSCALE_SERVE_ERROR: tailscaleServeError } : {}),
  };
}

async function unpublishTailscaleServe(exec = run) {
  if (!published) return;
  const { servePort, uiPort } = published;
  published = null;
  tailscaleServeUrl = null;
  const status = await serveStatus(exec);
  if (status.error || !proxiesTo(status.configs, servePort, uiPort)) return;
  await exec(["serve", `--https=${servePort}`, "off"], SERVE_TIMEOUT_MS);
}

module.exports = { publishTailscaleServe, serveEnv, unpublishTailscaleServe };
