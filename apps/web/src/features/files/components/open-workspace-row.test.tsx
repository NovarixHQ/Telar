import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenWorkspaceRow } from "./open-workspace-row";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    telarDesktop: { workspace: { open: async () => ({ ok: true }), reveal: async () => ({ ok: true }) } },
  };
});
afterAll(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else delete (globalThis as { window?: unknown }).window;
});

describe("the Open row", () => {
  test("opens in one press and offers the other apps behind a chevron", () => {
    const html = renderToStaticMarkup(<OpenWorkspaceRow path="/tmp/workspace" hostId="local" />);
    expect(html).toContain("Choose an app to open this folder with");
  });

  test("a remote session is refused by name, with nothing to choose", () => {
    const html = renderToStaticMarkup(<OpenWorkspaceRow path="/tmp/workspace" hostId="host_other" />);
    expect(html).toContain("Open workspace");
    expect(html).toContain("on another machine");
    expect(html).not.toContain("Choose an app to open this folder with");
  });
});
