import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PublishRows } from "./publish-rows";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function mount(over: { ahead?: number; github?: boolean; busy?: boolean } = {}) {
  const sendPush = mock(async () => ({ pushed: true }) as never);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <PublishRows
        sendPush={sendPush}
        sendPullRequest={mock(async () => ({}) as never)}
        branch="telar/header"
        commitsSinceBase={3}
        busy={over.busy ?? false}
        onPublished={() => {}}
        suggestion="Header"
        {...("ahead" in over ? { ahead: over.ahead } : {})}
        {...(over.github === undefined ? {} : { github: over.github })}
      />,
    ),
  );
  return { host, sendPush };
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text));

test("an unpublished branch offers to publish, and asks before it pushes", async () => {
  const { host, sendPush } = await mount();
  await act(async () => button(host, "Publish branch")!.click());
  expect(sendPush).not.toHaveBeenCalled();
  expect(host.textContent).toContain("This publishes the branch for the first time");
  await act(async () => button(host, "Push")!.click());
  expect(sendPush).toHaveBeenCalledTimes(1);
});

test("a branch origin already has in full has nothing to push", async () => {
  const { host } = await mount({ ahead: 0 });
  expect(button(host, "Push")!.disabled).toBe(true);
});

test("the pull request sits behind the chevron only where GitHub is ready", async () => {
  expect((await mount({ ahead: 1, github: true })).host.querySelector('[aria-label="More ways to publish"]')).not.toBeNull();
  expect((await mount({ ahead: 1 })).host.querySelector('[aria-label="More ways to publish"]')).toBeNull();
});
