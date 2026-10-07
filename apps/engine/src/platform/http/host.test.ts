import { expect, test } from "bun:test";
import os from "node:os";
import { hostIsAllowed, machineNames } from "./host";

const machine = os.hostname().toLowerCase().replace(/\.local$/, "");

test("loopback names and addresses pass, with or without a port", () => {
  for (const host of ["localhost", "localhost:3000", "127.0.0.1:4100", "LOCALHOST", "app.localhost:3000", "[::1]", "[::1]:3000"]) {
    expect(hostIsAllowed(host)).toBe(true);
  }
});

test("the machine's LAN, Tailscale and .local names pass", () => {
  for (const host of ["192.168.1.20:3000", "100.101.102.103:3000", "[fd7a:115c:a1e0::1]:3000", "mac.tail1234.ts.net", "mac.tail1234.ts.net.", `${machine}.local:3000`]) {
    expect(hostIsAllowed(host)).toBe(true);
  }
});

test("a rebinding name, another .local name and a malformed header are refused", () => {
  for (const host of ["evil.example", "evil.example:3000", "127.0.0.1.evil.example", "localhost.evil.example", "not-this-mac-xyz.local", "ts.net.evil.example", "::1", "", "[::1"]) {
    expect(hostIsAllowed(host)).toBe(false);
  }
});

test("a Mac whose hostname is its DHCP name still answers to its Bonjour and computer names", () => {
  const names = machineNames("mac.lan", "MINI-FBARBERA\n", "Facundo’s Mac mini");
  for (const host of ["mac.lan:3000", "mac.lan.local", "mini-fbarbera.local", "MINI-FBARBERA.local:4100", "mini-fbarbera", "facundos-mac-mini.local"]) {
    expect(hostIsAllowed(host, names)).toBe(true);
  }
  for (const host of ["evil.example", "mini-fbarbera.local.evil.example", "other-mac.local", "mini-fbarbera.lan.evil"]) {
    expect(hostIsAllowed(host, names)).toBe(false);
  }
});

test("without scutil, only the hostname's own names pass", () => {
  expect([...machineNames("Studio.local")]).toEqual(["studio", "studio.local"]);
});

test("no Host header passes, as from the desktop or the worker", () => {
  expect(hostIsAllowed(undefined)).toBe(true);
  expect(hostIsAllowed(null)).toBe(true);
});
