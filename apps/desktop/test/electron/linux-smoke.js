const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const executable = process.argv[2];
if (!executable) {
  console.error("usage: node linux-smoke.js <path to the packaged telar executable>");
  process.exit(2);
}

const { chromium } = require(path.resolve(__dirname, "..", "..", "..", "engine", "dist", "playwright-mcp", "node_modules", "playwright-core"));

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function until(check, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function readTerminal(engine, id, marker) {
  const response = await fetch(`http://${engine.host}:${engine.port}/v2/terminals/${id}/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${engine.token}` },
    body: JSON.stringify({ after: 0 }),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 20_000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      if (seen.includes(marker)) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error(`the terminal never printed ${marker}: ${seen.slice(-300)}`);
}

function readProcess(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const field = (name) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(status)?.[1].trim() ?? "";
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0\s]+/).filter(Boolean);
    return { pid, ppid: Number(field("PPid")), nspid: field("NSpid").split(/\s+/), seccomp: field("Seccomp"), args };
  } catch {
    return null;
  }
}

function assertSandboxed(rootPid) {
  const all = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map((name) => readProcess(Number(name))).filter(Boolean);
  const tree = new Set([rootPid]);
  for (let size = 0; size !== tree.size;) {
    size = tree.size;
    for (const proc of all) if (tree.has(proc.ppid)) tree.add(proc.pid);
  }
  const app = all.filter((proc) => tree.has(proc.pid));
  const unsandboxed = app.filter((proc) => proc.args.includes("--no-sandbox"));
  if (unsandboxed.length) throw new Error(`--no-sandbox on ${unsandboxed.map((proc) => proc.args.join(" ")).join("; ")}`);
  const renderers = app.filter((proc) => proc.args.includes("--type=renderer"));
  if (!renderers.length) throw new Error(`found no renderer among ${app.map((proc) => `${proc.pid}: ${proc.args.slice(0, 2).join(" ")}`).join(", ")}`);
  const bare = renderers.filter((proc) => proc.seccomp !== "2" || proc.nspid.length < 2);
  if (bare.length) throw new Error(`renderers outside the sandbox: ${bare.map((proc) => `${proc.pid} (Seccomp ${proc.seccomp}, NSpid ${proc.nspid.join(" ")})`).join(", ")}`);
  return renderers.length;
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-linux-smoke-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-linux-smoke-ud-"));
  const debuggingPort = await freePort();
  const env = {
    ...process.env,
    TELAR_HOME: home,
    TELAR_DESKTOP_REMOTE_DEBUGGING_PORT: String(debuggingPort),
    TELAR_DESKTOP_E2E_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  let output = "";
  globalThis.smokeOutput = () => output;
  delete env.ELECTRON_DISABLE_SANDBOX;
  const child = spawn(executable, ["telar://app/settings"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

  let browser;
  try {
    const discovery = path.join(home, "engine", "engine.json");
    const engine = await until(() => {
      try {
        return JSON.parse(fs.readFileSync(discovery, "utf8"));
      } catch {
        return null;
      }
    }, "the embedded engine's discovery file");
    console.log("LINUX_SMOKE engine up");

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`);
    const context = browser.contexts()[0];
    const cockpit = (page) => page.url().startsWith("telar://app/");
    const page = await until(() => context.pages().find(cockpit), "the cockpit window at telar://app/");
    await page.waitForFunction(() => window.telarDesktop?.isDesktop === true, null, { timeout: 30_000 });
    console.log("LINUX_SMOKE cockpit loaded over telar://app/");
    console.log(`LINUX_SMOKE sandbox on for ${assertSandboxed(child.pid)} renderers`);

    const onRoute = (route) => until(() => new URL(page.url()).pathname === route, `the cockpit to open ${route}`, 30_000);
    await onRoute("/settings");
    console.log("LINUX_SMOKE cold-start link opened /settings");

    const opened = await fetch(`http://${engine.host}:${engine.port}/v2/terminals/open`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${engine.token}` },
      body: JSON.stringify({ shell: "/bin/sh", args: ["-c", "echo TELAR_PTY_OK; sleep 30"] }),
    });
    if (!opened.ok) throw new Error(`opening a terminal answered ${opened.status}: ${await opened.text()}`);
    await readTerminal(engine, (await opened.json()).id, "TELAR_PTY_OK");
    console.log("LINUX_SMOKE terminal ran a command");

    const second = spawn(executable, ["telar://app/usage"], { env: { ...env, NO_CLEANUP: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    second.stdout.on("data", keep);
    second.stderr.on("data", keep);
    const secondExit = await new Promise((resolve) => second.once("exit", resolve));
    if (secondExit !== 0) throw new Error(`the second instance exited ${secondExit} instead of handing its link over`);
    await onRoute("/usage");
    console.log("LINUX_SMOKE second-instance link opened /usage");

    await Promise.all(context.pages().map((candidate) => candidate.close({ runBeforeUnload: false }).catch(() => {})));
    const result = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve({ code: null, signal: "no exit within 30s" }), 30_000)),
    ]);
    if (result.code !== 0) throw new Error(`the app did not quit cleanly (${result.signal ?? `exit ${result.code}`})`);
    console.log("LINUX_SMOKE_OK launch sandbox cockpit engine terminal quit");
  } catch (error) {
    console.error("LINUX_SMOKE_FAIL", error?.message || error, `\n--- app output ---\n${output}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

const watchdog = setTimeout(() => {
  console.error("LINUX_SMOKE_FAIL no result within 240s", `\n--- app output ---\n${globalThis.smokeOutput?.() ?? ""}`);
  process.exit(1);
}, 240_000);

void main().finally(() => {
  clearTimeout(watchdog);
  process.exit(process.exitCode ?? 0);
});
