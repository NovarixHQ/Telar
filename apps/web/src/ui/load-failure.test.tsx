import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SurfaceBoundary } from "./load-failure";

GlobalRegistrator.register({ url: "http://localhost/projects/project_a/sessions/session_a" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let failWith: Error | undefined;
let reloads = 0;
const quiet = spyOn(console, "error").mockImplementation(() => {});

function Surface() {
  if (failWith) throw failWith;
  return <p>the surface</p>;
}

function chunkError() {
  const error = new Error("Loading chunk editor failed.");
  error.name = "ChunkLoadError";
  return error;
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (tab = "tab_a") =>
    act(() => {
      root.render(
        <main>
          <nav>the rail</nav>
          <SurfaceBoundary resetKey={tab}>
            <Surface />
          </SurfaceBoundary>
        </main>,
      );
    });
  render();
  return {
    host,
    render,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  reloads = 0;
  failWith = undefined;
  Object.defineProperty(window.location, "reload", { configurable: true, value: () => void reloads++ });
});

afterEach(() => {
  quiet.mockClear();
});

describe("SurfaceBoundary", () => {
  test("a stale chunk reloads the window once and draws nothing in the meantime", () => {
    failWith = chunkError();
    const { host, unmount } = mount();
    expect(reloads).toBe(1);
    expect(host.textContent).toBe("the rail");
    unmount();
  });

  test("a second stale chunk inside the guard window shows the failure instead of looping", () => {
    failWith = chunkError();
    mount().unmount();
    const { host, unmount } = mount();
    expect(reloads).toBe(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("This surface couldn’t load.");
    expect(host.textContent).toContain("the rail");
    unmount();
  });

  test("any other error stays inside the surface, and Try again renders it afresh", () => {
    failWith = new Error("boom");
    const { host, unmount } = mount();
    expect(reloads).toBe(0);
    expect(host.textContent).toContain("the rail");
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    expect(retry).toBeDefined();

    failWith = undefined;
    act(() => retry!.click());
    expect(host.textContent).toContain("the surface");
    expect(host.querySelector('[role="alert"]')).toBe(null);
    unmount();
  });

  test("moving to another tab clears the failure", () => {
    failWith = new Error("boom");
    const { host, render, unmount } = mount();
    expect(host.querySelector('[role="alert"]')).not.toBe(null);

    failWith = undefined;
    render("tab_b");
    expect(host.textContent).toContain("the surface");
    unmount();
  });
});
