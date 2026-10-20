import { EngineClient } from "../../packages/engine-client/src/index.ts";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await Bun.sleep(250);
  }
}

const status = async (url: string, token?: string, init: RequestInit = {}): Promise<number> =>
  (await fetch(url, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" } })).status;

async function pair(base: string, code: string, name: string): Promise<void> {
  const answer = await fetch(`${base}/v2/remote/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
  if (!answer.ok) throw new Error(`pairing at ${base} answered ${answer.status}`);
  const { deviceId, deviceToken } = (await answer.json()) as { deviceId: string; deviceToken: string };
  console.log(JSON.stringify({ deviceId, deviceToken }));
}

async function turn(client: EngineClient, sessionId: string, runId: string, input: string): Promise<string> {
  await client.submitTurn(sessionId, { runId, input });
  const done = await until(() => client.session(sessionId), (s) => ["completed", "failed", "cancelled"].includes(s.turns.find((t) => t.runId === runId)?.state ?? ""), 120_000);
  const state = done.turns.find((t) => t.runId === runId)?.state;
  check(`turn ${runId} completed`, state === "completed", state);
  return (await client.turnAnswer(sessionId, { runId })).text;
}

async function exercise(): Promise<void> {
  const net = env("E2E_NET_URL");
  const tunnel = env("E2E_TUNNEL_URL");
  for (const base of [net, tunnel]) {
    const ping = (await (await fetch(`${base}/v2/ping`)).json()) as { ok: boolean; proto: number };
    check(`ping ${base} proto 2`, ping.ok && ping.proto === 2, JSON.stringify(ping));
  }
  check("engine token refused on the network listener", (await status(`${net}/v2/projects`, env("E2E_ENGINE_TOKEN"))) === 401);
  check("unpaired token refused", (await status(`${net}/v2/projects`, "tlr_notpaired")) === 401);
  check("no token refused", (await status(`${net}/v2/projects`)) === 401);

  const writer = new EngineClient({ baseUrl: () => net, token: env("E2E_NET_TOKEN") });
  const admin = new EngineClient({ baseUrl: () => tunnel, token: env("E2E_TUNNEL_TOKEN") });
  const stub = { driver: "acp", binaryPath: "/usr/local/bin/telar-e2e-agent", displayName: "Stub" } as const;
  check("read,write device cannot add a provider", (await status(`${net}/v2/provider-instances/stub`, env("E2E_NET_TOKEN"), { method: "PUT", body: JSON.stringify(stub) })) === 403);
  await admin.saveProviderInstance({ id: "stub", ...stub });

  const { project } = await writer.registerProject({ name: "e2e", root: env("E2E_PROJECT_ROOT") });
  const { session } = await writer.createSession({ projectId: project.id, providerInstanceId: "stub", envMode: "local" });
  check("transcript answer", (await turn(writer, session.id, "run_e2e_echo", "hello from the mac")).includes("echo:hello from the mac"));
  const snapshot = await writer.session(session.id);
  check("transcript items folded", snapshot.items.some((item) => JSON.stringify(item).includes("echo:hello from the mac")));

  const view = await writer.openTerminal(session.id, { command: "echo e2e-$((6*7)) && uname -s" });
  const waited = await writer.runWait(session.id, { terminalId: view.terminalId, pattern: "Linux", timeoutMs: 20_000 });
  const output = await writer.runOutput(session.id, { terminalId: view.terminalId });
  const plain = output.lines.map((line) => Bun.stripANSI(line.text).trim());
  check("engine terminal ran a command", waited.fired === "pattern" && plain.includes("e2e-42"), `${waited.fired}: ${plain.join(" | ")}`);

  const page = env("E2E_PAGE_URL");
  const browsed = await turn(writer, session.id, "run_e2e_browse", `browse ${page}`);
  check("agent browser tools navigated and snapshotted", browsed.includes("Telar e2e page"), browsed.slice(0, 400));
  const { browser } = await writer.browserState(session.id);
  check("engine browser is headless and on the page", browser.provider === "headless" && browser.tabs.some((tab) => tab.url.startsWith(page)), JSON.stringify({ provider: browser.provider, tabs: browser.tabs, error: browser.error }));
}

const [command, ...args] = process.argv.slice(2);
if (command === "pair") await pair(args[0]!, args[1]!, args[2]!);
else if (command === "refused") check(`revoked token refused at ${args[0]}`, (await status(`${args[0]}/v2/projects`, env("E2E_REVOKED_TOKEN"))) === 401);
else if (command === "exercise") await exercise();
else throw new Error("usage: client.ts pair <base> <code> <name> | refused <base> | exercise");
