import { expect, test } from "bun:test";
import { advertisedAddresses, dialableAddresses, listEndpoints } from "./endpoints";

const NICS = {
  en0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
  utun4: [{ family: "IPv4", address: "100.101.102.103", internal: false }, { family: "IPv6", address: "fd7a::1", internal: false }],
  lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  awdl0: [{ family: "IPv4", address: "169.254.3.4", internal: false }],
};

test("a wildcard bind is reachable at the loopback, every real interface and the MagicDNS name, nearest first", () => {
  const endpoints = listEndpoints({ host: "0.0.0.0", port: 4000 }, NICS, { TELAR_TAILSCALE_URL: "https://mac.tail1234.ts.net/" });
  expect(endpoints.map((endpoint) => [endpoint.kind, endpoint.url])).toEqual([
    ["loopback", "http://127.0.0.1:4000"],
    ["lan", "http://192.168.1.20:4000"],
    ["tailnet", "http://100.101.102.103:4000"],
    ["magicdns", "https://mac.tail1234.ts.net"],
  ]);
  expect(dialableAddresses(endpoints)).not.toContain("http://127.0.0.1:4000");
  expect(advertisedAddresses(endpoints)).toEqual(["http://100.101.102.103:4000", "https://mac.tail1234.ts.net", "http://192.168.1.20:4000"]);
});

test("a specific bind is reachable only at that address, and no listener means no endpoints", () => {
  expect(listEndpoints({ host: "100.64.0.9", port: 4000 }, NICS, {}).map((endpoint) => endpoint.kind)).toEqual(["tailnet"]);
  expect(listEndpoints(undefined, NICS, { TELAR_TAILSCALE_URL: "https://mac.ts.net" })).toEqual([]);
});
