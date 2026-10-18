import { describe, expect, test } from "bun:test";
import { hostFetcher, hostFromPathname, hostPrefix, LOCAL_HOST_ID, rewriteApiPath } from "@/platform/engine/host-client";

describe("hostFromPathname", () => {
  test("a remote screen names its host; everything else is local", () => {
    expect(hostFromPathname("/hosts/host_ab/projects/p/sessions/s")).toBe("host_ab");
    expect(hostFromPathname("/hosts/host%20x")).toBe("host x");
    expect(hostFromPathname("/projects/p/sessions/s")).toBe(LOCAL_HOST_ID);
    expect(hostFromPathname("/")).toBe(LOCAL_HOST_ID);
  });
});

describe("rewriteApiPath", () => {
  test("an api call from a remote screen goes through that host's proxy", () => {
    expect(rewriteApiPath("/v2/projects", "host_ab")).toBe("/v2/hosts/host_ab/api/projects");
    expect(rewriteApiPath("/v2/sessions/s1/turns?x=1", "host_ab")).toBe("/v2/hosts/host_ab/api/sessions/s1/turns?x=1");
  });

  test("local is the absence of the hop", () => {
    expect(rewriteApiPath("/v2/projects", LOCAL_HOST_ID)).toBe("/v2/projects");
    expect(hostPrefix(LOCAL_HOST_ID)).toBe("");
    expect(hostPrefix(undefined)).toBe("");
    expect(hostPrefix("host_ab")).toBe("/hosts/host_ab");
  });

  // The hosts routes are this cockpit's own book; a remote's book is not
  // ours, and a nested hop would loop.
  test("the hosts routes are never proxied", () => {
    expect(rewriteApiPath("/v2/hosts", "host_ab")).toBe("/v2/hosts");
    expect(rewriteApiPath("/v2/hosts/host_ab", "host_ab")).toBe("/v2/hosts/host_ab");
    expect(rewriteApiPath("/v2/hosts", "host_ab")).toBe("/v2/hosts");
    expect(rewriteApiPath("/v2/hosts/host_ab/api/projects", "host_ab")).toBe("/v2/hosts/host_ab/api/projects");
  });

  test("non-api paths are left alone", () => {
    expect(rewriteApiPath("https://example.com/api/x", "host_ab")).toBe("https://example.com/api/x");
    expect(rewriteApiPath("/_next/static/x.js", "host_ab")).toBe("/_next/static/x.js");
  });
});

describe("hostFetcher", () => {
  test("pins every string request to one host", async () => {
    const seen: string[] = [];
    const base = (async (input: string | URL | Request) => {
      seen.push(typeof input === "string" ? input : String(input));
      return new Response("{}");
    }) as typeof fetch;
    await hostFetcher("host_ab", base)("/v2/projects");
    await hostFetcher(LOCAL_HOST_ID, base)("/v2/projects");
    expect(seen).toEqual(["/v2/hosts/host_ab/api/projects", "/v2/projects"]);
  });
});

describe("a row's own Mac", () => {
  test("a fetcher for a remote row hops; a local row does not", async () => {
    // What `sessionFetch` in session-inbox-menu.tsx relies on: settle, snooze,
    // rename and delete on a paired Mac's row must land on that engine.
    const seen: string[] = [];
    const base = (async (input: string | URL | Request) => {
      seen.push(typeof input === "string" ? input : String(input));
      return new Response("{}");
    }) as typeof fetch;
    await hostFetcher("host_ab", base)("/v2/sessions/s1", { method: "PATCH" });
    await hostFetcher(LOCAL_HOST_ID, base)("/v2/sessions/s1", { method: "PATCH" });
    expect(seen).toEqual(["/v2/hosts/host_ab/api/sessions/s1", "/v2/sessions/s1"]);
  });
});
