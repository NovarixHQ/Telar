const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createTunnel, launchOverSsh, platformOf } = require("./ssh-launch");

let dir;
let server;
let ssh;
let log;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-ssh-"));
  log = path.join(dir, "calls.log");
  ssh = path.join(dir, "ssh");
  fs.writeFileSync(
    ssh,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_SSH_LOG"
for last; do :; done
case "$last" in
  "uname -sm") [ -n "$FAKE_DENY" ] && { echo "$FAKE_DENY" >&2; exit 255; }; echo "\${FAKE_UNAME:-Linux x86_64}" ;;
  "test -x"*) exit "\${FAKE_INSTALLED:-0}" ;;
  *"install.sh"*) exit "\${FAKE_INSTALL_EXIT:-0}" ;;
  *"service install"*) exit "\${FAKE_SERVICE_EXIT:-0}" ;;
  *" pair "*) echo "Link: http://127.0.0.1:7420/pair#token=12345678"; exit 0 ;;
esac
`,
    { mode: 0o755 },
  );
});
afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  server = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

function listen() {
  return new Promise((resolve) => {
    server = http.createServer((_request, response) => response.end("{}")).listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const calls = () => fs.readFileSync(log, "utf8").trim().split("\n");
const launch = async (extra = {}, env = {}) => {
  const localPort = await listen();
  const tunnel = { start() {}, stop() {}, reconnectNow() {} };
  const result = await launchOverSsh({ target: "me@box", base: "https://dl.example.org/telar", localPort, ssh, tunnel, env: { ...process.env, FAKE_SSH_LOG: log, ...env }, ...extra });
  return { result, localPort };
};

describe("adding a computer over ssh", () => {
  test("detects the system, installs, starts the service, forwards a port and pairs through it", async () => {
    const forwarded = [];
    const { result, localPort } = await launch({ tunnel: { start: () => forwarded.push("start"), stop() {}, reconnectNow() {} } }, { FAKE_INSTALLED: "1" });

    expect(result.pairingUrl).toBe(`http://127.0.0.1:${localPort}/pair#token=12345678`);
    expect(forwarded).toEqual(["start"]);
    const [uname, installed, install, service, pair] = calls();
    expect(uname).toEndWith("-- me@box uname -sm");
    expect(installed).toContain('test -x "$HOME/.telar/runtime/current/telar"');
    expect(install).toContain("install.sh");
    expect(install).toContain("--base 'https://dl.example.org/telar'");
    expect(service).toContain('service install --host 127.0.0.1 --port 7420');
    expect(pair).toContain("pair --scopes read,write,admin");
    expect(calls().every((line) => line.includes("BatchMode=yes"))).toBe(true);
  });

  test("skips the install when telar is already there, even with no download address", async () => {
    await launch({ base: undefined });
    expect(calls().some((line) => line.includes("install.sh"))).toBe(false);
  });

  test("refuses to install while the download address is the placeholder", async () => {
    await expect(launch({ base: "https://downloads.example.invalid/telar" }, { FAKE_INSTALLED: "1" })).rejects.toMatchObject({ code: "base_unset" });
    expect(calls().some((line) => line.includes("service install"))).toBe(false);
  });

  test("names the failure: no ssh, a refused key, an unknown host key, an unsupported machine, a bad target", async () => {
    await expect(launch({ ssh: path.join(dir, "missing-ssh") })).rejects.toMatchObject({ code: "no_ssh" });
    await expect(launch({}, { FAKE_DENY: "me@box: Permission denied (publickey)." })).rejects.toMatchObject({ code: "auth_failed" });
    await expect(launch({}, { FAKE_DENY: "Host key verification failed." })).rejects.toMatchObject({ code: "host_key" });
    await expect(launch({}, { FAKE_DENY: "ssh: connect to host box port 22: Connection refused" })).rejects.toMatchObject({ code: "unreachable" });
    await expect(launch({}, { FAKE_UNAME: "Linux armv7l" })).rejects.toMatchObject({ code: "unsupported" });
    await expect(launch({ target: "-oProxyCommand=evil" })).rejects.toMatchObject({ code: "bad_target" });
    await expect(launch({ target: "me@box; rm -rf ~" })).rejects.toMatchObject({ code: "bad_target" });
  });

  test("stops the forward when the host never answers or the service cannot start", async () => {
    const stopped = [];
    const tunnel = { start() {}, stop: () => stopped.push("stop"), reconnectNow() {} };
    await expect(launch({ tunnel }, { FAKE_SERVICE_EXIT: "1" })).rejects.toMatchObject({ code: "failed" });
    const localPort = await listen();
    server.close();
    server = undefined;
    const sleep = async () => {
      throw Object.assign(new Error("gave up"), { code: "no_answer" });
    };
    await expect(
      launchOverSsh({ target: "me@box", base: "https://dl.example.org/telar", localPort, ssh, tunnel, sleep, fetchImpl: async () => Promise.reject(new Error("down")), env: { ...process.env, FAKE_SSH_LOG: log, FAKE_INSTALLED: "0" } }),
    ).rejects.toMatchObject({ code: "no_answer" });
    expect(stopped).toEqual(["stop"]);
  });
});

describe("platforms", () => {
  test("the three builds are recognised", () => {
    expect(platformOf("Linux x86_64\n")).toBe("linux-x64");
    expect(platformOf("Linux aarch64")).toBe("linux-arm64");
    expect(platformOf("Darwin arm64")).toBe("darwin-arm64");
    expect(() => platformOf("Darwin x86_64")).toThrow("no build");
  });
});

describe("the forward", () => {
  function harness() {
    const children = [];
    const timers = [];
    const spawnImpl = (_ssh, args) => {
      const child = Object.assign(new EventEmitter(), { args, killed: false, kill() { this.killed = true; this.emit("close", null); } });
      children.push(child);
      return child;
    };
    const schedule = (fn, ms) => (timers.push({ fn, ms }), timers.length);
    const cancel = (id) => (timers[id - 1].cancelled = true);
    const tunnel = createTunnel({ ssh: "ssh", target: "me@box", localPort: 5555, spawnImpl, schedule, cancel });
    return { tunnel, children, timers };
  }

  test("forwards the local port to the remote engine", () => {
    const { tunnel, children } = harness();
    tunnel.start();
    expect(children[0].args).toContain("127.0.0.1:5555:127.0.0.1:7420");
    expect(children[0].args).toContain("-N");
  });

  test("reopens after the connection drops, waiting longer each time, and again at once on a network change", () => {
    const { tunnel, children, timers } = harness();
    tunnel.start();
    children[0].emit("close", 255);
    expect(timers.map((timer) => timer.ms)).toEqual([1_000]);
    timers[0].fn();
    children[1].emit("close", 255);
    expect(timers.map((timer) => timer.ms)).toEqual([1_000, 2_000]);
    tunnel.reconnectNow();
    expect(timers[1].cancelled).toBe(true);
    expect(children).toHaveLength(3);
  });

  test("a stopped forward stays closed", () => {
    const { tunnel, children, timers } = harness();
    tunnel.start();
    tunnel.stop();
    expect(children[0].killed).toBe(true);
    expect(timers).toHaveLength(0);
  });
});
