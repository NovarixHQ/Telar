const { afterAll, afterEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { publishTailscaleServe, serveEnv, unpublishTailscaleServe } = require("./tailscale");

const UI_PORT = 42731;
const DOMAIN = "mac.tailnet.ts.net";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-tailscale-home-"));
fs.mkdirSync(path.join(home, "remote"));
fs.writeFileSync(
  path.join(home, "remote", "remote.json"),
  JSON.stringify({ version: 1, requireAuth: true, exposure: "network-accessible", tailscaleServe: true, devices: [] }),
);
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const mapping = (servePort, target) => ({
  TCP: { [servePort]: { HTTPS: true } },
  Web: { [`${DOMAIN}:${servePort}`]: { Handlers: { "/": { Proxy: target } } } },
});
const merge = (...configs) => ({
  TCP: Object.assign({}, ...configs.map((c) => c.TCP)),
  Web: Object.assign({}, ...configs.map((c) => c.Web)),
});

function fakeTailscale(initial = {}) {
  const state = { config: structuredClone(initial), calls: [] };
  const ok = (stdout = "") => ({ ok: true, spawnFailed: false, exitCode: 0, stdout, stderr: "" });
  state.exec = async (args) => {
    state.calls.push(args);
    if (args[0] === "status") return ok(JSON.stringify({ CertDomains: [DOMAIN] }));
    if (args[1] === "status") return ok(JSON.stringify(state.config));
    const servePort = args.find((a) => a.startsWith("--https=")).slice("--https=".length);
    const key = `${DOMAIN}:${servePort}`;
    state.config.TCP ??= {};
    state.config.Web ??= {};
    if (args.at(-1) === "off") {
      delete state.config.TCP[servePort];
      delete state.config.Web[key];
    } else {
      state.config.TCP[servePort] = { HTTPS: true };
      state.config.Web[key] = { Handlers: { "/": { Proxy: args.at(-1) } } };
    }
    return ok();
  };
  return state;
}

const telar = `http://127.0.0.1:${UI_PORT}`;
const foreign = "http://127.0.0.1:3773";

afterEach(() => unpublishTailscaleServe(async () => ({ ok: false, stdout: "", stderr: "" })));

describe("choosing where to publish", () => {
  test("a free 443 is used", async () => {
    const ts = fakeTailscale();
    expect(await publishTailscaleServe(home, UI_PORT, ts.exec)).toBe(`https://${DOMAIN}`);
    expect(ts.config.Web[`${DOMAIN}:443`].Handlers["/"].Proxy).toBe(telar);
  });

  test("443 already proxying to Telar is reused", async () => {
    const ts = fakeTailscale(mapping(443, telar));
    expect(await publishTailscaleServe(home, UI_PORT, ts.exec)).toBe(`https://${DOMAIN}`);
    expect(ts.config.Web[`${DOMAIN}:443`].Handlers["/"].Proxy).toBe(telar);
  });

  test("a foreign 443 is left alone and Telar takes a free fallback port", async () => {
    const ts = fakeTailscale(mapping(443, foreign));
    const url = await publishTailscaleServe(home, UI_PORT, ts.exec);
    expect(url).toBe(`https://${DOMAIN}:4443`);
    expect(serveEnv().TELAR_TAILSCALE_URL).toBe(url);
    expect(ts.config.Web[`${DOMAIN}:443`].Handlers["/"].Proxy).toBe(foreign);
    expect(ts.config.Web[`${DOMAIN}:4443`].Handlers["/"].Proxy).toBe(telar);
  });

  test("a fallback port held by another app is skipped", async () => {
    const ts = fakeTailscale(merge(mapping(443, foreign), mapping(4443, "http://127.0.0.1:9000")));
    expect(await publishTailscaleServe(home, UI_PORT, ts.exec)).toBe(`https://${DOMAIN}:4444`);
    expect(ts.config.Web[`${DOMAIN}:4443`].Handlers["/"].Proxy).toBe("http://127.0.0.1:9000");
  });

  test("a mapping held by a foreground serve session counts as taken", async () => {
    const ts = fakeTailscale({ Foreground: { session1: mapping(443, foreign) } });
    expect(await publishTailscaleServe(home, UI_PORT, ts.exec)).toBe(`https://${DOMAIN}:4443`);
  });
});

describe("unpublishing", () => {
  test("turns off the port Telar published", async () => {
    const ts = fakeTailscale(mapping(443, foreign));
    await publishTailscaleServe(home, UI_PORT, ts.exec);
    await unpublishTailscaleServe(ts.exec);
    expect(ts.config.TCP["4443"]).toBeUndefined();
    expect(ts.config.Web[`${DOMAIN}:443`].Handlers["/"].Proxy).toBe(foreign);
  });

  test("leaves 443 alone once another app has taken it over", async () => {
    const ts = fakeTailscale();
    await publishTailscaleServe(home, UI_PORT, ts.exec);
    ts.config = mapping(443, foreign);
    await unpublishTailscaleServe(ts.exec);
    expect(ts.config.Web[`${DOMAIN}:443`].Handlers["/"].Proxy).toBe(foreign);
    expect(ts.calls.some((args) => args.at(-1) === "off")).toBe(false);
  });

  test("does nothing when nothing was published", async () => {
    const ts = fakeTailscale(mapping(443, foreign));
    await unpublishTailscaleServe(ts.exec);
    expect(ts.calls).toEqual([]);
  });
});
