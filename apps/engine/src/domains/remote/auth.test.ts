import { describe, expect, test } from "bun:test";
import { decideAccess, EXEMPT_PATHS } from "./auth";
import type { DeviceScope } from "@telar/engine-client";
import { ALL_SCOPES, normaliseScopes, requiredScope, scopesForRole } from "./scopes";
import { hashToken, type RemoteFile } from "./store";
import { StreamTickets } from "../simulators";

const RAW = "tlr_" + "a".repeat(43);

function file(overrides: Partial<RemoteFile> = {}, role: "full" | "observer" = "full"): RemoteFile {
  return {
    version: 1,
    requireAuth: true,
    devices: [{ id: "dev_1", name: "Phone", tokenHash: hashToken(RAW), createdAt: 1, scopes: scopesForRole(role) }],
    ...overrides,
  };
}

function ask(
  pathname: string,
  credentials: { authorization?: string; deviceCookie?: string; method?: string } = {},
  remote = file(),
) {
  return decideAccess(
    remote,
    {
      pathname,
      method: credentials.method ?? "GET",
      authorization: credentials.authorization ?? null,
      deviceCookie: credentials.deviceCookie ?? null,
    },
    undefined,
  );
}

describe("api gate", () => {
  test("everything passes while requireAuth is off", () => {
    expect(ask("/v2/health", {}, file({ requireAuth: false }))).toEqual({ allow: true });
  });

  test("a tokenless request is refused once requireAuth is on", () => {
    expect(ask("/v2/sessions/live")).toEqual({ allow: false, code: "cockpit_unauthorized" });
  });

  test("/v2/mcp reaches the engine for any caller on an allowed host, which then checks the bearer", () => {
    expect(ask("/v2/mcp", { method: "POST" })).toEqual({ allow: true });
    expect(ask("/v2/mcp", { method: "POST", authorization: `Bearer ${RAW}` }, file({}, "observer"))).toEqual({ allow: true });
    expect(decideAccess(file(), { pathname: "/v2/mcp", method: "POST", host: "evil.example" }, undefined)).toEqual({ allow: false, code: "cockpit_misdirected" });
  });

  test("/v2/health is gated by name — it identifies the daemon", () => {
    expect(ask("/v2/health")).toEqual({ allow: false, code: "cockpit_unauthorized" });
  });

  test("a rebinding Host is refused before anything else, even with auth off; loopback and LAN pass", () => {
    const decide = (host: string | null, remote = file()) =>
      decideAccess(remote, { pathname: "/v2/pair", method: "GET", authorization: `Bearer ${RAW}`, host }, undefined);
    expect(decide("evil.example:3000", file({ requireAuth: false }))).toEqual({ allow: false, code: "cockpit_misdirected" });
    expect(decide("evil.example")).toEqual({ allow: false, code: "cockpit_misdirected" });
    for (const host of ["127.0.0.1:3000", "[::1]:3000", "192.168.1.20:3000", "mac.tail1234.ts.net", null]) {
      expect(decide(host)).toEqual({ allow: true });
    }
  });

  test("the exemptions answer strangers", () => {
    for (const pathname of EXEMPT_PATHS) {
      expect(ask(pathname)).toEqual({ allow: true });
    }
  });

  test("a bearer token admits the device", () => {
    expect(ask("/v2/health", { authorization: `Bearer ${RAW}` })).toEqual({ allow: true, deviceId: "dev_1", scopes: ALL_SCOPES });
  });

  test("the cookie admits a paired browser", () => {
    expect(ask("/v2/health", { deviceCookie: RAW })).toEqual({ allow: true, deviceId: "dev_1", scopes: ALL_SCOPES });
  });

  test("the bearer wins over the cookie when both are present", () => {
    expect(ask("/v2/health", { authorization: `Bearer ${RAW}`, deviceCookie: "tlr_wrong" })).toEqual({
      allow: true,
      deviceId: "dev_1",
      scopes: ALL_SCOPES,
    });
  });

  test("a revoked device's token is refused", () => {
    expect(ask("/v2/health", { authorization: `Bearer ${RAW}` }, file({ devices: [] }))).toEqual({
      allow: false,
      code: "cockpit_unauthorized",
    });
  });

  test("a malformed authorization header is refused, not crashed on", () => {
    expect(ask("/v2/health", { authorization: "Bearer not-a-telar-token" })).toEqual({
      allow: false,
      code: "cockpit_unauthorized",
    });
    expect(ask("/v2/health", { authorization: "Basic dXNlcg==" })).toEqual({
      allow: false,
      code: "cockpit_unauthorized",
    });
  });

  test("a full device may write", () => {
    expect(ask("/v2/sessions/x/turns", { authorization: `Bearer ${RAW}`, method: "POST" })).toEqual({
      allow: true,
      deviceId: "dev_1",
      scopes: ALL_SCOPES,
    });
  });

  test("an observer may GET and HEAD, nothing else", () => {
    const observer = file({}, "observer");
    expect(ask("/v2/health", { authorization: `Bearer ${RAW}` }, observer)).toEqual({
      allow: true,
      deviceId: "dev_1",
      scopes: ["read"],
    });
    expect(ask("/v2/health", { authorization: `Bearer ${RAW}`, method: "HEAD" }, observer)).toEqual({
      allow: true,
      deviceId: "dev_1",
      scopes: ["read"],
    });
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(ask("/v2/sessions/x/turns", { authorization: `Bearer ${RAW}`, method }, observer)).toEqual({
        allow: false,
        code: "cockpit_forbidden",
      });
    }
  });

  test("an observer watches a terminal's stream but cannot type into it or resize it", () => {
    const observer = file({}, "observer");
    const as = (pathname: string, method: string) => ask(pathname, { authorization: `Bearer ${RAW}`, method }, observer);
    expect(as("/v2/sessions/s1/run/bytes/stream?terminalId=t1", "GET")).toEqual({ allow: true, deviceId: "dev_1", scopes: ["read"] });
    expect(as("/v2/sessions/s1/run/write", "POST")).toEqual({ allow: false, code: "cockpit_forbidden" });
    expect(as("/v2/sessions/s1/run/resize", "POST")).toEqual({ allow: false, code: "cockpit_forbidden" });
    expect(ask("/v2/sessions/s1/run/write", { authorization: `Bearer ${RAW}`, method: "POST" })).toEqual({ allow: true, deviceId: "dev_1", scopes: ALL_SCOPES });
  });

  test("an observer cannot escalate itself — the device routes are writes too", () => {
    expect(ask("/v2/remote/devices/dev_1", { authorization: `Bearer ${RAW}`, method: "PATCH" }, file({}, "observer"))).toEqual({
      allow: false,
      code: "cockpit_forbidden",
    });
  });

  test("the pairing exchange stays open to an observer's POST — it is exempt by path", () => {
    expect(ask("/v2/pair", { method: "POST" }, file({}, "observer"))).toEqual({ allow: true });
  });
});

describe("scopes", () => {
  const withScopes = (scopes: DeviceScope[]): RemoteFile => {
    const base = file();
    return { ...base, devices: base.devices.map((device) => ({ ...device, scopes })) };
  };
  const as = (scopes: DeviceScope[], pathname: string, method: string) => ask(pathname, { authorization: `Bearer ${RAW}`, method }, withScopes(scopes));
  const FORBIDDEN = { allow: false, code: "cockpit_forbidden" } as const;

  test("what a request needs comes from one table, by path and method", () => {
    expect(requiredScope("GET", "/v2/sessions/live")).toBe("read");
    expect(requiredScope("HEAD", "/v2/health")).toBe("read");
    expect(requiredScope("POST", "/v2/sessions/s1/turns")).toBe("write");
    expect(requiredScope("GET", "/v2/remote")).toBe("admin");
    expect(requiredScope("POST", "/v2/remote/pairing")).toBe("admin");
    expect(requiredScope("DELETE", "/v2/remote/devices/dev_1")).toBe("admin");
    expect(requiredScope("GET", "/v2/hosts")).toBe("admin");
    expect(requiredScope("GET", "/v2/plugins")).toBe("read");
    expect(requiredScope("POST", "/v2/plugins/install")).toBe("admin");
    expect(requiredScope("PUT", "/v2/computer-use/settings")).toBe("admin");
  });

  test("write covers changing sessions but not devices, pairing or settings", () => {
    expect(as(["read", "write"], "/v2/sessions/s1/turns", "POST")).toMatchObject({ allow: true, scopes: ["read", "write"] });
    expect(as(["read", "write"], "/v2/remote/pairing", "POST")).toEqual(FORBIDDEN);
    expect(as(["read", "write"], "/v2/remote", "GET")).toEqual(FORBIDDEN);
    expect(as(["read", "write"], "/v2/plugins/install", "POST")).toEqual(FORBIDDEN);
  });

  test("read alone reaches no write and no admin route", () => {
    expect(as(["read"], "/v2/sessions/live", "GET")).toMatchObject({ allow: true });
    expect(as(["read"], "/v2/sessions/s1/turns", "POST")).toEqual(FORBIDDEN);
    expect(as(["read"], "/v2/remote", "GET")).toEqual(FORBIDDEN);
  });

  test("admin reaches everything", () => {
    for (const [pathname, method] of [["/v2/remote", "GET"], ["/v2/remote/devices/dev_1", "DELETE"], ["/v2/sessions/s1/turns", "POST"]] as const) {
      expect(as(["read", "write", "admin"], pathname, method)).toMatchObject({ allow: true });
    }
  });

  test("scopes normalise upward, and unknown ones are refused", () => {
    expect(normaliseScopes(["admin"])).toEqual(["read", "write", "admin"]);
    expect(normaliseScopes(["write"])).toEqual(["read", "write"]);
    expect(normaliseScopes(["read", "root"])).toBeUndefined();
    expect(normaliseScopes([])).toBeUndefined();
  });
});

describe("simulators", () => {
  const STREAM = "/v2/simulators/hub/vendor/serve-sim/helper/A1B2/stream.mjpeg";
  const tickets = new StreamTickets();
  const decide = (pathname: string, method: string, ticket: string | null, remote = file()) =>
    decideAccess(remote, { pathname, method, ticket }, undefined, (path, verb, value) => tickets.check(path, verb, value));

  test("an observer watches a simulator but cannot touch it or change its settings", () => {
    const observer = file({}, "observer");
    expect(ask(STREAM, { authorization: `Bearer ${RAW}` }, observer)).toMatchObject({ allow: true, scopes: ["read"] });
    expect(ask("/v2/simulators/A1B2/input", { authorization: `Bearer ${RAW}`, method: "POST" }, observer)).toEqual({ allow: false, code: "cockpit_forbidden" });
    expect(ask("/v2/simulators/A1B2/action", { authorization: `Bearer ${RAW}`, method: "POST" }, observer)).toEqual({ allow: false, code: "cockpit_forbidden" });
  });

  test("a stream ticket stands in for credentials only on hub reads, and only while its device is paired", () => {
    const { ticket } = tickets.mint("dev_1");
    expect(decide(STREAM, "GET", ticket)).toEqual({ allow: true, deviceId: "dev_1", scopes: ["read"] });
    expect(decide("/v2/simulators/A1B2/input", "POST", ticket)).toEqual({ allow: false, code: "cockpit_unauthorized" });
    expect(decide("/v2/sessions/live", "GET", ticket)).toEqual({ allow: false, code: "cockpit_unauthorized" });
    expect(decide(STREAM, "GET", ticket, file({ devices: [] }))).toEqual({ allow: false, code: "cockpit_unauthorized" });
    expect(decide(STREAM, "GET", tickets.mint(null).ticket, file({ devices: [] }))).toEqual({ allow: true, scopes: ["read"] });
  });
});

describe("the process that runs the server", () => {
  const HOST = "tlr_" + "h".repeat(43);
  const file = { version: 1 as const, requireAuth: true, devices: [] };
  const asHost = (credentials: { deviceCookie?: string; hostHeader?: string; method?: string }, secret: string | null = HOST) =>
    decideAccess(
      file,
      {
        pathname: "/v2/projects",
        method: credentials.method ?? "GET",
        authorization: null,
        deviceCookie: credentials.deviceCookie ?? null,
        hostHeader: credentials.hostHeader ?? null,
      },
      secret ?? undefined,
    );

  test("the host's secret is a full-role caller without a device record", () => {
    expect(asHost({ deviceCookie: HOST, method: "POST" })).toEqual({ allow: true, scopes: ALL_SCOPES });
  });

  test("the header alone admits the host, with no cookie at all", () => {
    expect(asHost({ hostHeader: HOST, method: "POST" })).toEqual({ allow: true, scopes: ALL_SCOPES });
  });

  test("a near-miss header is refused, by length and by content", () => {
    expect(asHost({ hostHeader: HOST + "x" }).allow).toBe(false);
    expect(asHost({ hostHeader: HOST.slice(0, -1) + "z" }).allow).toBe(false);
    expect(asHost({ hostHeader: HOST.slice(0, -1) }).allow).toBe(false);
  });

  test("with no secret set, an empty header is not a pass either", () => {
    expect(asHost({ deviceCookie: "" }, null)).toEqual({ allow: false, code: "cockpit_unauthorized" });
    expect(asHost({ hostHeader: "" }, null)).toEqual({ allow: false, code: "cockpit_unauthorized" });
    expect(asHost({ hostHeader: HOST }, null)).toEqual({ allow: false, code: "cockpit_unauthorized" });
  });

  test("a wrong header does not spoil a right cookie", () => {
    expect(asHost({ hostHeader: "tlr_stale", deviceCookie: HOST })).toEqual({ allow: true, scopes: ALL_SCOPES });
  });

  test("a near-miss is still refused", () => {
    expect(asHost({ deviceCookie: HOST + "x" }).allow).toBe(false);
    expect(asHost({ deviceCookie: HOST.slice(0, -1) + "z" }).allow).toBe(false);
  });
});
