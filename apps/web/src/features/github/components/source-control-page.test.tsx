import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { searchSettings, SETTINGS_SEARCH_INDEX } from "@/features/settings";
import { SourceControlPage } from "./source-control-page";

GlobalRegistrator.register({ url: "http://localhost/settings" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => await GlobalRegistrator.unregister());

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await Promise.resolve());
};

test("the row is drawn before the probe answers", () => {
  const html = renderToStaticMarkup(<SourceControlPage />);
  expect(html).toContain("GitHub");
  expect(html).toContain("Read through a CLI you signed in to yourself");
  expect(html).not.toContain("Sessions get the same access you have in a terminal");
});

test("no row exists only to say a thing does not exist", () => {
  const html = renderToStaticMarkup(<SourceControlPage />);
  expect(html).not.toContain("GitLab");
  expect(html).not.toContain("Not supported");
});

function serve(answer: () => Response) {
  const asked: string[] = [];
  const [realFetch, realSetTimeout] = [globalThis.fetch, window.setTimeout];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return answer();
  }) as typeof fetch;
  window.setTimeout = ((fn: () => void) => void queueMicrotask(fn)) as unknown as typeof window.setTimeout;
  const restore = () => {
    globalThis.fetch = realFetch;
    window.setTimeout = realSetTimeout;
  };
  return { asked, restore };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

async function mount() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<SourceControlPage />));
  await flush();
  return { host, unmount: () => act(() => root.unmount()) };
}

test("a broken gh names the command that fixes it, and Check again re-asks the machine, not a project", async () => {
  let auth: Record<string, unknown> = { signedIn: false, unavailable: "not_installed" };
  const { asked, restore } = serve(() => json({ auth }));
  const page = await mount();
  try {
    expect(page.host.textContent).toContain("brew install gh");

    auth = { signedIn: false, unavailable: "not_authenticated" };
    await act(async () => page.host.querySelector<HTMLElement>('[aria-label="Check gh again"]')!.click());
    await flush();
    expect(page.host.textContent).toContain("gh auth login");
    expect(page.host.textContent).not.toContain("brew install gh");
    expect(asked).toEqual(["/api/github/cli", "/api/github/cli"]);
  } finally {
    page.unmount();
    restore();
  }
});

test("a signed-in gh shows the account, whatever projects exist", async () => {
  const { restore } = serve(() => json({ auth: { signedIn: true, account: "octo-cat" } }));
  const page = await mount();
  try {
    expect(page.host.textContent).toContain("Authenticated");
    expect(page.host.textContent).toContain("octo-cat");
    expect(page.host.textContent).not.toContain("Project folder not found");
  } finally {
    page.unmount();
    restore();
  }
});

test("an engine that does not answer says so on the row", async () => {
  const { restore } = serve(() => new Response("{}", { status: 503 }));
  const page = await mount();
  try {
    expect(page.host.textContent).toContain("gh could not answer");
    expect(page.host.textContent).toContain("gh auth status");
  } finally {
    page.unmount();
    restore();
  }
});

test("search finds the pane by the CLI, not only by its name", () => {
  const first = (query: string) => searchSettings(SETTINGS_SEARCH_INDEX, query)[0];
  expect(first("gh cli")?.pageId).toBe("source-control");
  expect(first("github")?.pageId).toBe("source-control");
  expect(first("source control")?.pageId).toBe("source-control");
});
