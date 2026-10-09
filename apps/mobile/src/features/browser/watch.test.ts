import { describe, expect, test } from "bun:test";
import type { BrowserSnapshot, BrowserTab } from "@telar/engine-client";
import { addressUrl, BrowserWatch, pageLabel, pageNotice, pickPage } from "./watch";

const page = (id: string, patch: Partial<BrowserTab> = {}): BrowserTab => ({ id, url: `https://${id}.dev/x`, title: "", active: false, ...patch });
const read = (tabs: BrowserTab[], patch: Partial<BrowserSnapshot> = {}): BrowserSnapshot => ({ scopeKey: "s", provider: "desktop", running: true, tabs, ...patch }) as BrowserSnapshot;

describe("BrowserWatch", () => {
  test("keeps the screenshot for the page with focus", () => {
    const watch = new BrowserWatch();
    watch.absorb(read([page("a"), page("b", { active: true })], { screenshot: "data:image/png;base64,AAA" }));
    expect(watch.state().image).toEqual({ pageId: "b", uri: "data:image/png;base64,AAA" });
    expect(watch.state().snapshot?.tabs).toHaveLength(2);
  });

  test("a read that changes nothing notifies nobody", () => {
    const watch = new BrowserWatch();
    const tabs = [page("a", { active: true })];
    watch.absorb(read(tabs, { screenshot: "data:1" }));
    let heard = 0;
    watch.subscribe(() => heard++);
    watch.absorb(read(tabs, { screenshot: "data:1" }));
    watch.absorb(read(tabs));
    expect(heard).toBe(0);
    watch.absorb(read(tabs, { screenshot: "data:2" }));
    expect(heard).toBe(1);
    expect(watch.state().image?.uri).toBe("data:2");
  });

  test("an open returns the page it created", () => {
    const watch = new BrowserWatch();
    const opened = watch.absorb(read([page("a", { active: true }), page("b")]), new Set(["a"]));
    expect(opened?.id).toBe("b");
    expect(watch.absorb(read([page("a", { active: true })]), new Set(["a"]))?.id).toBe("a");
  });

  test("reports the engine's error and a failed read", () => {
    const watch = new BrowserWatch();
    watch.absorb(read([], { error: "No browser" }));
    expect(watch.state().failure).toBe("No browser");
    watch.fail(new Error("offline"));
    expect(watch.state().failure).toBe("offline");
  });
});

test("pages are named by title, else host", () => {
  expect(pageLabel(page("a", { title: "Docs" }))).toBe("Docs");
  expect(pageLabel(page("a"))).toBe("a.dev");
  expect(pageLabel(page("a", { url: "" }))).toBe("New page");
});

test("a bare address becomes https", () => {
  expect(addressUrl(" example.com ")).toBe("https://example.com");
  expect(addressUrl("http://localhost:3000")).toBe("http://localhost:3000");
});

test("shows the wanted page, else the focused one", () => {
  const pages = [page("a"), page("b", { active: true })];
  expect(pickPage(pages, "a")?.id).toBe("a");
  expect(pickPage(pages, "gone")?.id).toBe("b");
});

test("explains why there is no picture", () => {
  const running = { snapshot: read([]) };
  expect(pageNotice(running, undefined)).toBe("The agent closed it, or the session ended.");
  expect(pageNotice({ snapshot: read([], { running: false }) }, page("a"))).toBe("The browser is not running.");
  expect(pageNotice(running, page("a"))).toBe("Only the page with focus can be photographed.");
  expect(pageNotice(running, page("a", { active: true }))).toBe("Waiting for the first screenshot.");
});
