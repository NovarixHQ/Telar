const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRemoteHost, parsePairingLink } = require("./remote-host");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-remote-host-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const TOKEN = "tlr_" + "d".repeat(43);

function fetchFrom(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const handler = handlers[new URL(url).pathname];
    if (!handler) throw new TypeError("fetch failed");
    return handler(init);
  };
  return { fetchImpl, calls };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const pairing = { "/api/pair": () => json({ deviceToken: TOKEN }), "/api/health": () => json({ hostname: "mini" }) };

describe("pairing links", () => {
  test("read the address and the code from the fragment", () => {
    expect(parsePairingLink("http://Mini.local:7420/pair#token=12345678")).toEqual({ baseUrl: "http://mini.local:7420", code: "12345678" });
    expect(parsePairingLink(`telar://pair?link=${encodeURIComponent("https://mini.ts.net/pair#token=12345678")}`)).toEqual({ baseUrl: "https://mini.ts.net:443", code: "12345678" });
  });

  test("refuse a code in the query string and anything that is not a code", () => {
    expect(parsePairingLink("http://mini:7420/pair?token=12345678")).toBeUndefined();
    expect(parsePairingLink("http://mini:7420/pair#token=abc")).toBeUndefined();
    expect(parsePairingLink("not a link")).toBeUndefined();
  });
});

describe("the remote computer", () => {
  test("a fresh install runs the engine on this Mac and has no endpoint", () => {
    const host = createRemoteHost({ dir });
    expect(host.publicMode()).toEqual({ local: true, remote: null });
    expect(host.endpoint()).toBeNull();
  });

  test("connecting pairs, keeps the credential in a private file and exposes it only as an endpoint", async () => {
    const { fetchImpl, calls } = fetchFrom(pairing);
    const host = createRemoteHost({ dir, fetchImpl });
    const mode = await host.connect("http://mini:7420/pair#token=12345678", "Studio");

    expect(mode).toEqual({ local: false, remote: { baseUrl: "http://mini:7420", name: "mini" } });
    expect(JSON.stringify(mode)).not.toContain(TOKEN);
    expect(host.endpoint()).toEqual({ baseUrl: "http://mini:7420", token: TOKEN });
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ token: "12345678", deviceName: "Studio" });
    const file = path.join(dir, "remote-host.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(createRemoteHost({ dir }).endpoint()).toEqual({ baseUrl: "http://mini:7420", token: TOKEN });
  });

  test("a refused or unreachable pairing changes nothing", async () => {
    const refused = createRemoteHost({ dir, fetchImpl: fetchFrom({ "/api/pair": () => json({ error: { message: "That code expired." } }, 401) }).fetchImpl });
    await expect(refused.connect("http://mini:7420/pair#token=12345678", "Studio")).rejects.toThrow("That code expired.");
    const down = createRemoteHost({ dir, fetchImpl: fetchFrom({}).fetchImpl });
    await expect(down.connect("http://mini:7420/pair#token=12345678", "Studio")).rejects.toThrow("did not answer");
    await expect(down.connect("nonsense", "Studio")).rejects.toThrow("pairing link");
    expect(down.publicMode()).toEqual({ local: true, remote: null });
    expect(fs.existsSync(path.join(dir, "remote-host.json"))).toBe(false);
  });

  test("switching back keeps the pairing, and switching away again needs no new code", async () => {
    const host = createRemoteHost({ dir, fetchImpl: fetchFrom(pairing).fetchImpl });
    await host.connect("http://mini:7420/pair#token=12345678", "Studio");
    expect(host.useLocal(true).local).toBe(true);
    expect(host.endpoint()).toBeNull();
    expect(host.useLocal(false)).toEqual({ local: false, remote: { baseUrl: "http://mini:7420", name: "mini" } });
    expect(host.endpoint()?.token).toBe(TOKEN);
  });

  test("without a pairing the engine stays on this Mac, and forgetting returns to it", async () => {
    const host = createRemoteHost({ dir, fetchImpl: fetchFrom(pairing).fetchImpl });
    expect(host.useLocal(false).local).toBe(true);
    await host.connect("http://mini:7420/pair#token=12345678", "Studio");
    expect(host.forget()).toEqual({ local: true, remote: null });
    expect(createRemoteHost({ dir }).endpoint()).toBeNull();
  });

  test("a damaged file reads as this Mac", () => {
    fs.writeFileSync(path.join(dir, "remote-host.json"), JSON.stringify({ local: false, remote: { baseUrl: "http://mini:7420" } }));
    expect(createRemoteHost({ dir }).publicMode()).toEqual({ local: true, remote: null });
  });
});
