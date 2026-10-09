import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as navigation from "next/navigation";
import { buttonLabelled, click, flush, installTestDom, mount } from "@/test/dom";

let viewing = "/projects/p1/sessions/s1";
mock.module("next/navigation", () => ({ ...navigation, usePathname: () => viewing }));

const { MessageResponse } = await import("@/ui/message");
const { inAppHref } = await import("@/ui/markdown-link");

installTestDom();

const KEY = "telar:open-links-in-session-browser";
const dialog = () => document.querySelector('[role="dialog"]');

async function linkIn(markdown: string) {
  const { host } = await mount(<div data-transcript><MessageResponse>{markdown}</MessageResponse></div>);
  return { host, link: host.querySelector('[data-streamdown="link"]') as HTMLAnchorElement };
}

beforeEach(() => {
  viewing = "/projects/p1/sessions/s1";
  window.localStorage.clear();
  window.history.replaceState(null, "", "/projects/p1/sessions/s1");
});

describe("a link to the cockpit's own route", () => {
  test("navigates in-app with no dialog", async () => {
    const { link } = await linkIn("Open [the builder](/projects/p1/sessions/s2).");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("target")).toBeNull();
    await click(link);
    expect(dialog()).toBeNull();
    expect(window.location.pathname).toBe("/projects/p1/sessions/s2");
  });

  test("in a cockpit viewing a remote host, it lands on that host's route", async () => {
    viewing = "/hosts/studio/projects/p1/sessions/s1";
    const { link } = await linkIn("Open [the builder](/projects/p1/sessions/s2).");
    expect(link.getAttribute("href")).toBe("/hosts/studio/projects/p1/sessions/s2");
    await click(link);
    expect(dialog()).toBeNull();
    expect(window.location.pathname).toBe("/hosts/studio/projects/p1/sessions/s2");
  });

  test("a same-origin URL counts as in-app; other origins and unknown paths do not", () => {
    const origin = "http://localhost";
    expect(inAppHref("http://localhost/projects/p/sessions/s?x=1", "/", origin)).toBe("/projects/p/sessions/s?x=1");
    expect(inAppHref("/projects/p/sessions/s", "/hosts/a%20b/projects/p", origin)).toBe("/hosts/a%20b/projects/p/sessions/s");
    expect(inAppHref("/hosts/h/projects/p/sessions/s", "/hosts/other/x", origin)).toBe("/hosts/h/projects/p/sessions/s");
    expect(inAppHref("https://example.com/projects/p", "/", origin)).toBeUndefined();
    expect(inAppHref("//example.com/projects/p", "/", origin)).toBeUndefined();
    expect(inAppHref("/api/projects", "/", origin)).toBeUndefined();
  });
});

describe("an external link", () => {
  test("asks before leaving, in a dialog drawn over the whole window rather than inside the transcript", async () => {
    const { host, link } = await linkIn("See [the docs](https://example.com/docs).");
    await click(link);
    await flush(() => dialog() !== null);
    expect(dialog()?.textContent).toContain("https://example.com/docs");
    expect(host.contains(dialog())).toBe(false);
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    expect(host.contains(overlay)).toBe(false);
    expect(window.location.pathname).toBe("/projects/p1/sessions/s1");
  });

  test("opening it from the dialog hands it to a new window, which the desktop shell sends to the browser", async () => {
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = ((...args: unknown[]) => (opened.push(args), null)) as typeof window.open;
    try {
      const { link } = await linkIn("See [the docs](https://example.com/docs).");
      await click(link);
      await flush(() => dialog() !== null);
      await click(buttonLabelled("Open link"));
    } finally {
      window.open = original;
    }
    expect(opened).toEqual([["https://example.com/docs", "_blank", "noreferrer"]]);
    await flush(() => dialog() === null);
    expect(dialog()).toBeNull();
  });

  test("with links opening in the session's browser there is no dialog, just a new-window anchor", async () => {
    window.localStorage.setItem(KEY, "1");
    const { link } = await linkIn("See [the docs](https://example.com/docs).");
    expect(link.getAttribute("target")).toBe("_blank");
    const stopLeaving = (event: Event) => event.preventDefault();
    window.addEventListener("click", stopLeaving);
    try {
      await click(link);
    } finally {
      window.removeEventListener("click", stopLeaving);
    }
    expect(dialog()).toBeNull();
  });
});
