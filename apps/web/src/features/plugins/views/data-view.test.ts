import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { installTestDom, flush } from "@/test/dom";

installTestDom();

const PAGE = fs.readFileSync(path.resolve(import.meta.dir, "../../../../../engine/plugins/data-science/views/data.html"), "utf8").replace(/<link[^>]*>/g, "");
const NO_PYTHON = "data science has no Python interpreter: choose one in the project's settings";

type Listener = (event: { name: string; data: unknown }) => void;

let closed = false;
const cockpitTelar = Object.getOwnPropertyDescriptor(window, "telar");

/** Loads Data Science's Data view against a stand-in bridge, the way the cockpit's frame runs it. */
function open(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: { verb: string; input?: Record<string, unknown> }[] = [];
  const listeners: Listener[] = [];
  (window as unknown as { telar: unknown }).telar = {
    version: 1,
    context: async () => ({ plugin: "data-science", view: "data" }),
    call: async (verb: string, input?: Record<string, unknown>) => {
      if (closed) return new Promise(() => undefined);
      calls.push({ verb, ...(input ? { input } : {}) });
      const answer = answers[verb];
      if (!answer) throw new Error(`no ${verb}`);
      return answer(input);
    },
    onEvent: (listener: Listener) => void listeners.push(listener),
    onTheme: () => undefined,
  };
  const doc = new DOMParser().parseFromString(PAGE, "text/html");
  const script = doc.querySelector("script")!.textContent!;
  doc.querySelectorAll("script").forEach((node) => node.remove());
  document.body.innerHTML = doc.body.innerHTML;
  new Function(script)();
  const text = (id: string) => document.getElementById(id)!.textContent ?? "";
  return { calls, emit: (event: { name: string; data?: unknown }) => listeners.forEach((listener) => listener({ data: undefined, ...event })), text };
}

const tab = (name: string) => (document.querySelector(`[data-tab="${name}"]`) as HTMLButtonElement).click();

// A view left running would keep drawing into whatever document the next test file mounts.
afterEach(async () => {
  closed = true;
  await flush();
  // The cockpit keeps its own `window.telar` (dictation) for the whole run.
  if (cockpitTelar) Object.defineProperty(window, "telar", cockpitTelar);
  else delete (window as unknown as { telar?: unknown }).telar;
  document.body.innerHTML = "";
  closed = false;
});

test("a tab that cannot load says why in its own place, instead of keeping the last tab's content", async () => {
  const view = open({
    kernel: () => { throw new Error(NO_PYTHON); },
    plots: () => ({ plots: [] }),
    packages: () => { throw new Error(NO_PYTHON); },
  });
  await flush(() => view.text("body").includes("No plots yet"));
  tab("environment");
  await flush(() => view.text("body").includes(NO_PYTHON));
  expect(view.text("body")).toContain(NO_PYTHON);
  expect(view.text("body")).not.toContain("No plots yet");
});

test("choosing an environment redraws the view without a refresh", async () => {
  let chosen = false;
  const view = open({
    kernel: () => (chosen ? { state: "none" } : (() => { throw new Error(NO_PYTHON); })()),
    plots: () => ({ plots: [] }),
    packages: () => (chosen ? { packages: [{ name: "pandas", version: "2.2.0" }], environment: { manager: "telar", root: "/home/python/p" } } : (() => { throw new Error(NO_PYTHON); })()),
  });
  await flush(() => view.text("body").includes("No plots yet"));
  tab("environment");
  await flush(() => view.text("body").includes(NO_PYTHON));
  chosen = true;
  view.emit({ name: "settings.changed" });
  await flush(() => view.text("body").includes("pandas"));
  expect(view.text("body")).toContain("pandas");
  expect(view.text("body")).not.toContain(NO_PYTHON);
});

test("Enter on the Plot line draws through the kernel and shows what it answered", async () => {
  const view = open({
    kernel: () => ({ state: "none" }),
    plots: () => ({ plots: [] }),
    plot: () => ({ ok: false, outputs: [], error: "NameError: name 'plt' is not defined" }),
  });
  await flush(() => view.text("body").includes("No plots yet"));
  const line = document.getElementById("code") as HTMLInputElement;
  line.value = "plt.plot([1, 3, 2])";
  line.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flush(() => view.text("answer").includes("NameError"));
  expect(view.calls.find((call) => call.verb === "plot")?.input?.code).toContain("plt.plot([1, 3, 2])");
  expect(view.text("answer")).toContain("NameError: name 'plt' is not defined");
});
