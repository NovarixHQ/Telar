import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as navigation from "next/navigation";
import { act } from "react";
import { buttonLabelled, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";

mock.module("next/navigation", () => ({ ...navigation, usePathname: () => "/projects/p1/sessions/s1" }));

const { MessageResponse } = await import("@/ui/message");
const { Toaster, toastManager } = await import("@/ui/toast");
const { useLinkRouting } = await import("./use-link-routing");

installTestDom();

const KEY = "telar:open-links-in-session-browser";

function installShell({ refuse }: { refuse?: string } = {}) {
  const opened: string[] = [];
  const external: string[] = [];
  const routing: boolean[] = [];
  let listener: ((payload: { url?: unknown }) => void) | undefined;
  (window as unknown as { telarDesktop?: unknown }).telarDesktop = {
    browser: {
      getState: async (scopeKey: string) => ({ scopeKey, tabs: opened.map((url, index) => ({ id: `t${index}`, index, url, active: index === opened.length - 1 })) }),
      bindProfile: async () => ({}),
      action: async (scopeKey: string, action: { action: string; url: string }) => {
        if (refuse) throw new Error(`Error invoking remote method 'telar:browser:action': Error: ${refuse}`);
        opened.push(action.url);
        return { scopeKey, tabs: [] };
      },
      openExternal: async (url: string) => (external.push(url), { ok: true }),
    },
    links: {
      setRouting: async (on: boolean) => void routing.push(on),
      onOpen: (next: typeof listener) => ((listener = next), () => (listener = undefined)),
    },
  };
  return { opened, external, routing, shellOpens: (url: string) => listener?.({ url }) };
}

function Conversation({ markdown }: { markdown: string }) {
  const panel = { showPanelTab: () => {}, updatePanel: () => {} } as unknown as Parameters<typeof useLinkRouting>[0]["panel"];
  const onClick = useLinkRouting({ hostId: "local", projectId: "p1", sessionId: "s1", solo: false, panel });
  return (
    <div onClickCapture={onClick}>
      <MessageResponse>{markdown}</MessageResponse>
      <pre><a href="https://tool.test/out">tool output</a></pre>
      <Toaster />
    </div>
  );
}

const MARKDOWN = "See [the docs](https://docs.test/a) and https://auto.test/b";
const linkTo = (host: HTMLElement, href: string) => host.querySelector(`a[href="${href}"]`) as HTMLAnchorElement;

async function modifierClick(link: HTMLElement, init: MouseEventInit) {
  let prevented = false;
  const type = init.button === 1 ? "auxclick" : "click";
  const record = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener(type, record);
  await act(async () => void link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })));
  document.removeEventListener(type, record);
  return prevented;
}

beforeEach(() => {
  window.localStorage.clear();
  stubFetch({});
  window.history.replaceState(null, "", "/projects/p1/sessions/s1");
});

describe("with links set to open in the session's browser", () => {
  beforeEach(() => window.localStorage.setItem(KEY, "1"));

  test("a plain click on a markdown link, an autolinked URL or a link in tool output opens it in the session's browser", async () => {
    const shell = installShell();
    const { host } = await mount(<Conversation markdown={MARKDOWN} />);
    for (const href of ["https://docs.test/a", "https://auto.test/b", "https://tool.test/out"]) await click(linkTo(host, href));
    await flush(() => shell.opened.length === 3);
    expect(shell.opened).toEqual(["https://docs.test/a", "https://auto.test/b", "https://tool.test/out"]);
    expect(shell.external).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("⌘-click and middle-click are left to the shell, which hands them back to the session's browser", async () => {
    const shell = installShell();
    const { host } = await mount(<Conversation markdown={MARKDOWN} />);
    await flush(() => shell.routing.at(-1) === true);
    expect(await modifierClick(linkTo(host, "https://docs.test/a"), { metaKey: true })).toBe(false);
    expect(await modifierClick(linkTo(host, "https://auto.test/b"), { button: 1 })).toBe(false);
    shell.shellOpens("https://docs.test/a");
    shell.shellOpens("https://auto.test/b");
    await flush(() => shell.opened.length === 2);
    expect(shell.opened).toEqual(["https://docs.test/a", "https://auto.test/b"]);
    expect(shell.external).toEqual([]);
  });

  test("a link the session's browser refuses says why and opens outside only when asked", async () => {
    const shell = installShell({ refuse: "Tab limit reached (12 per session). Close a tab first." });
    const { host } = await mount(<Conversation markdown={MARKDOWN} />);
    await click(linkTo(host, "https://docs.test/a"));
    await flush(() => document.body.textContent?.includes("Tab limit reached") ?? false);
    expect(document.body.textContent).toContain("Tab limit reached (12 per session). Close a tab first.");
    expect(document.body.textContent).not.toContain("Error invoking remote method");
    expect(shell.external).toEqual([]);
    await click(buttonLabelled("Open outside Telar")!);
    await flush(() => shell.external.length > 0);
    expect(shell.external).toEqual(["https://docs.test/a"]);
    await act(async () => toastManager.close());
  });
});

describe("with links set to open outside", () => {
  test("a plain click asks before leaving, and nothing opens in the session's browser", async () => {
    const shell = installShell();
    const { host } = await mount(<Conversation markdown={MARKDOWN} />);
    await click(linkTo(host, "https://docs.test/a"));
    await flush(() => document.querySelector('[role="dialog"]') !== null);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("https://docs.test/a");
    expect(shell.opened).toEqual([]);
  });

  test("the shell is told not to route this window's links, so ⌘-click opens outside", async () => {
    const shell = installShell();
    await mount(<Conversation markdown={MARKDOWN} />);
    await flush(() => shell.routing.length > 0);
    expect(shell.routing.at(-1)).toBe(false);
    shell.shellOpens("https://docs.test/a");
    await flush();
    expect(shell.opened).toEqual([]);
  });
});
