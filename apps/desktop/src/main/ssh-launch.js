const { spawn } = require("node:child_process");

const REMOTE_PORT = 7420;
const TELAR = '"$HOME/.telar/runtime/current/telar"';
const TARGET = /^[A-Za-z0-9_][A-Za-z0-9._@:%+-]*$/;
const BASE = /^https?:\/\/[A-Za-z0-9._~:/%+-]+$/;
const OPTIONS = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
const PAIR_LINK_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 30_000;

class SshError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function checkTarget(target) {
  const value = typeof target === "string" ? target.trim() : "";
  if (!TARGET.test(value)) throw new SshError("bad_target", "Type the computer as user@host, or a name from your ~/.ssh/config.");
  return value;
}

function platformOf(uname) {
  const [system, machine] = uname.trim().split(/\s+/);
  if (system === "Linux" && (machine === "x86_64" || machine === "amd64")) return "linux-x64";
  if (system === "Linux" && (machine === "aarch64" || machine === "arm64")) return "linux-arm64";
  if (system === "Darwin" && machine === "arm64") return "darwin-arm64";
  throw new SshError("unsupported", `Telar has no build for ${system ?? "this system"} ${machine ?? ""}`.trim() + ". It runs on Linux (x64, arm64) and Apple-silicon Macs.");
}

function describeFailure(target, { code, stderr }) {
  const text = stderr.trim();
  if (/Permission denied|no mutual signature|Too many authentication failures/i.test(text)) {
    return new SshError("auth_failed", `ssh could not sign in to ${target}. Load its key in your agent (ssh-add) and check that \`ssh ${target}\` works in Terminal.`);
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(text)) {
    return new SshError("host_key", `ssh does not trust ${target} yet. Run \`ssh ${target}\` once in Terminal to accept its key.`);
  }
  if (/Could not resolve|timed out|refused|No route|unreachable|closed by remote host|Network is down/i.test(text)) {
    return new SshError("unreachable", `${target} did not answer over ssh: ${text.split("\n").at(-1)}`);
  }
  return new SshError("failed", `ssh to ${target} failed (exit ${code})${text ? `: ${text.split("\n").at(-1).slice(0, 300)}` : "."}`);
}

function runSsh({ ssh, target, command, env, spawnImpl }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(ssh, [...OPTIONS, "--", target, command], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      reject(error.code === "ENOENT" ? new SshError("no_ssh", "ssh was not found on this Mac. Install OpenSSH and try again.") : error),
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function must(options, command) {
  const done = await runSsh({ ...options, command });
  if (done.code !== 0) throw describeFailure(options.target, done);
  return done.stdout;
}

function installCommand(base) {
  const script = `${base}/install.sh`;
  return `if command -v curl >/dev/null 2>&1; then curl -fsSL '${script}'; else wget -qO- '${script}'; fi | sh -s -- --base '${base}'`;
}

async function ensureInstalled(options, base) {
  const present = await runSsh({ ...options, command: `test -x ${TELAR}` });
  if (present.code === 0) return;
  if (present.code !== 1) throw describeFailure(options.target, present);
  if (!base || /example\.invalid/.test(base)) {
    throw new SshError("base_unset", "This build has no download address for Telar, so it cannot install it on that computer. Install telar there yourself and add it with its pairing link.");
  }
  if (!BASE.test(base)) throw new SshError("base_unset", "The download address for Telar is not a plain http(s) address.");
  await must(options, installCommand(base.replace(/\/+$/, "")));
}

async function untilReady(url, fetchImpl, sleep) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      if ((await fetchImpl(`${url}/v2/ping`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
    }
    if (Date.now() > deadline) return Promise.reject(new SshError("no_answer", "Telar was installed there but did not answer. Check `systemctl --user status telar` (Linux) on that computer."));
    await sleep(500);
  }
}

function mintPairing({ ssh, target, env, spawnImpl, localPort }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(ssh, [...OPTIONS, "--", target, `${TELAR} pair --scopes read,write,admin`], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => fail(new SshError("pair_failed", "That computer did not print a pairing link.")), PAIR_LINK_TIMEOUT_MS);
    const fail = (error) => {
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    child.on("error", (error) => fail(error.code === "ENOENT" ? new SshError("no_ssh", "ssh was not found on this Mac. Install OpenSSH and try again.") : error));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (err += chunk));
    child.on("close", (code) => {
      if (code !== 0 && !out.includes("Link:")) fail(describeFailure(target, { code, stderr: err }));
    });
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      out += chunk;
      const link = /Link: (\S+)/.exec(out)?.[1];
      if (!link) return;
      let hash;
      try {
        hash = new URL(link).hash;
      } catch {
        return;
      }
      clearTimeout(timer);
      resolve({ pairingUrl: `http://127.0.0.1:${localPort}/pair${hash}` });
    });
  });
}

// Keeps `ssh -N -L` alive, restarting it with a growing delay until stop().
function createTunnel({ ssh, target, localPort, remotePort = REMOTE_PORT, env, spawnImpl = spawn, schedule = setTimeout, cancel = clearTimeout, log = () => {} }) {
  const delays = [1_000, 2_000, 5_000, 10_000, 30_000];
  let child = null;
  let timer = null;
  let stopped = false;
  let failures = 0;

  function open() {
    timer = null;
    const startedAt = Date.now();
    const current = spawnImpl(ssh, [...OPTIONS, "-N", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, "--", target], { env, stdio: "ignore" });
    child = current;
    current.on("error", () => {});
    current.on("close", (code) => {
      if (child === current) child = null;
      if (stopped) return;
      failures = Date.now() - startedAt > 30_000 ? 0 : failures + 1;
      const wait = delays[Math.min(failures, delays.length) - 1] ?? 0;
      log(`ssh tunnel to ${target} ended (exit ${code}); reconnecting in ${wait}ms`);
      timer = schedule(open, wait);
    });
  }

  return {
    start() {
      stopped = false;
      open();
    },
    reconnectNow() {
      if (stopped) return;
      failures = 0;
      if (child) child.kill();
      else if (timer) {
        cancel(timer);
        open();
      }
    },
    stop() {
      stopped = true;
      if (timer) cancel(timer);
      child?.kill();
    },
  };
}

// Installs Telar on the other computer if needed, starts it, forwards a local port to it
// and returns a one-time pairing link that works through that forward.
async function launchOverSsh({ target, base, localPort, ssh = "ssh", env = process.env, spawnImpl = spawn, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = () => {}, tunnel }) {
  const options = { ssh, target: checkTarget(target), env, spawnImpl };
  platformOf(await must(options, "uname -sm"));
  await ensureInstalled(options, base);
  await must(options, `${TELAR} service install --host 127.0.0.1 --port ${REMOTE_PORT}`);
  const forward = tunnel ?? createTunnel({ ssh, target: options.target, localPort, env, spawnImpl, log });
  forward.start();
  try {
    await untilReady(`http://127.0.0.1:${localPort}`, fetchImpl, sleep);
    const { pairingUrl } = await mintPairing({ ...options, localPort });
    return { pairingUrl, tunnel: forward };
  } catch (error) {
    forward.stop();
    throw error;
  }
}

module.exports = { checkTarget, createTunnel, launchOverSsh, platformOf };
