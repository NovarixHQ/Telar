import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { ActivityBar } = await import("./activity-bar");
const { rememberSettingsReturn } = await import("@/features/settings");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function show(at: string) {
  pathname = at;
  await act(async () => root.render(<ActivityBar />));
}

const link = (name: string) => host.querySelector<HTMLAnchorElement>(`nav[aria-label="App"] a[aria-label="${name}"]`)!;

test("Home and Settings are named links, Home first and Settings last", async () => {
  await show("/");
  const names = [...host.querySelectorAll("nav a")].map((anchor) => anchor.getAttribute("aria-label"));
  expect(names).toEqual(["Home", "Settings"]);
  expect(link("Settings").getAttribute("href")).toBe("/settings");
});

test("Home is current in the workspace", async () => {
  await show("/projects/p1/sessions/s1");
  expect(link("Home").getAttribute("aria-current")).toBe("page");
  expect(link("Settings").hasAttribute("aria-current")).toBe(false);
});

test("Settings is current on both settings pages", async () => {
  for (const at of ["/settings", "/projects/p1/settings"]) {
    await show(at);
    expect(link("Settings").getAttribute("aria-current")).toBe("page");
    expect(link("Home").hasAttribute("aria-current")).toBe(false);
  }
});

test("Home from Settings goes back to the page Settings was opened from", async () => {
  rememberSettingsReturn("/projects/p1/sessions/s1?panel=diff");
  await show("/settings");
  expect(link("Home").getAttribute("href")).toBe("/projects/p1/sessions/s1?panel=diff");
});

test("each icon takes keyboard focus", async () => {
  await show("/");
  for (const name of ["Home", "Settings"]) {
    link(name).focus();
    expect(document.activeElement).toBe(link(name));
  }
});
