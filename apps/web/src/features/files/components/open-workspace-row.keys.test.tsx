import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { runCommand } from "@/features/commands";
import { flush, installTestDom, mount } from "@/test/dom";
import { writePreferredOpener } from "../workspace-opener-preference";
import { OpenWorkspaceRow } from "./open-workspace-row";

installTestDom();

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  (window as unknown as { telarDesktop: unknown }).telarDesktop = {
    workspace: {
      openers: async () => ({ openers: [{ id: "vscode", label: "VS Code" }, { id: "zed", label: "Zed" }] }),
      open: async (path: string, opener?: string) => (calls.push(`open ${path} ${opener}`), { ok: true }),
      reveal: async (path: string) => (calls.push(`reveal ${path}`), { ok: true }),
    },
  };
});

afterEach(() => {
  delete (window as unknown as { telarDesktop?: unknown }).telarDesktop;
});

async function row(preferred?: string) {
  writePreferredOpener("local", preferred ?? "none");
  const { host } = await mount(<OpenWorkspaceRow path="/work" hostId="local" />);
  await flush(() => host.textContent?.includes("Open in") === true || host.textContent?.includes("Reveal") === true);
  return host;
}

describe("⌘O and ⌥⌘O on the Open row", () => {
  test("the main button names the preferred app, and ⌘O opens the folder in it", async () => {
    const host = await row("zed");
    expect(host.textContent).toContain("Open in Zed");
    act(() => void runCommand("open-in-app"));
    await flush(() => calls.length > 0);
    expect(calls).toEqual(["open /work zed"]);
  });

  test("with no preferred app, ⌘O does what the button does: reveal", async () => {
    await row();
    act(() => void runCommand("open-in-app"));
    await flush(() => calls.length > 0);
    expect(calls).toEqual(["reveal /work"]);
  });

  test("⌥⌘O reveals even when an app is preferred", async () => {
    await row("vscode");
    act(() => void runCommand("reveal-in-finder"));
    await flush(() => calls.length > 0);
    expect(calls).toEqual(["reveal /work"]);
  });
});
