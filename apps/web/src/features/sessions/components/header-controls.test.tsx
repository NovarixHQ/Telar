import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenWorkspaceButton } from "@/features/files/components/open-workspace-button";
import { RailToggle } from "@/features/panel";
import { RunHeaderControl } from "@/features/terminal";
import type { RunApi } from "@/features/terminal";

const FAMILY = ["border-border", "bg-background"];

const runApi = {
  configurations: async () => ({ configurations: [] }),
  status: async () => ({ terminals: [] }),
} as unknown as RunApi;

/** The desktop bridge lives on `window`, and the Open button renders its
 *  unavailable shape without one. Installed for this file only. */
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

const cluster = () => ({
  run: renderToStaticMarkup(<RunHeaderControl sessionId="session_1" api={runApi} />),
  open: renderToStaticMarkup(<OpenWorkspaceButton path="/tmp/workspace" hostId="local" />),
});

describe("the header cluster reads as buttons", () => {
  test("Run and Open carry the bordered variant", () => {
    for (const [name, html] of Object.entries(cluster())) {
      for (const signature of FAMILY) {
        expect(`${name}: ${html.includes(signature)}`).toBe(`${name}: true`);
      }
    }
  });

  test("they are the same height, so the row has one baseline", () => {
    // `sm` and `icon-sm` are both h-7; the Run pill says so in its own class
    // list because it overrides the padding around it.
    const { run, open } = cluster();
    expect(run).toContain("h-7");
    expect(open).toContain("size-7");
  });

  test("the panel toggle keeps its quiet look, as asked", () => {
    const html = renderToStaticMarkup(<RailToggle open={false} onToggle={() => {}} />);
    expect(html).toContain("Open right panel");
    for (const signature of FAMILY) expect(html).not.toContain(signature);
  });
});

describe("the Open control", () => {
  // The group WRAPPER, not the word: every Button carries an
  // `in-data-[slot=button-group]:` rounding rule whether or not it is in one.
  const GROUPED = 'role="group"';

  test("is a split button: one half opens, the other offers the rest", () => {
    const html = renderToStaticMarkup(<OpenWorkspaceButton path="/tmp/workspace" hostId="local" />);
    expect(html).toContain("Choose an app to open this folder with");
    expect(html).toContain(GROUPED);
  });

  test("a remote session is refused by name rather than split", () => {
    // Nothing to split when there is nothing to open — see the component.
    const html = renderToStaticMarkup(<OpenWorkspaceButton path="/tmp/workspace" hostId="host_other" />);
    expect(html).toContain("Open workspace");
    expect(html).toContain("on another machine");
    expect(html).not.toContain(GROUPED);
  });
});
