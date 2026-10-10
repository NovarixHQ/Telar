import { expect, test } from "bun:test";
import { act, useState } from "react";
import type { PluginStatus } from "@telar/engine-client";
import { installTestDom, mount, flush, stubFetch } from "@/test/dom";
import { usePluginContributions } from "@/features/plugins";
import { Composer } from "./composer";

installTestDom();

const NOTES: PluginStatus = {
  state: "ready",
  meta: {
    id: "notes",
    api: 1,
    name: "Notes",
    version: "0.1.0",
    toolPrefixes: [],
    readTools: [],
    eventKinds: [],
    settings: [],
    composer: {
      decorations: [
        { id: "ticket", pattern: "#[0-9]+", style: "accent" },
        { id: "math", pattern: String.raw`(?<!\$)\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?![\d$])`, style: "math", preview: { renderer: "katex" } },
      ],
      commands: [{ name: "shout", description: "Say it louder", verb: "shout", hint: "what to say" }],
    },
  },
  installed: { linked: false },
};

function Box({ initial, enabled, onSend }: { initial: string; enabled: readonly string[]; onSend: (draft: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const { composer } = usePluginContributions("local", enabled, "session_a");
  return (
    <Composer
      draft={draft}
      ready
      attachments={[]}
      onAttach={() => {}}
      busy={false}
      fresh={false}
      driver="claude"
      sending={false}
      backgroundTasks={0}
      projectId="project_a"
      extensions={composer}
      onDraftChange={setDraft}
      onSubmit={() => onSend(draft)}
      onStop={() => {}}
      onStopBackground={() => {}}
      onRuntimeMode={() => {}}
    />
  );
}

const ON = ["notes"];

async function composer(initial: string, shout: (body: { text: string }) => unknown = ({ text }) => ({ text: `${text.toUpperCase()}!` }), enabled: readonly string[] = ON) {
  const sent: string[] = [];
  const calls = stubFetch({
    "GET /api/plugins": () => ({ plugins: [NOTES], machine: { version: 1, entries: {} } }),
    "POST /api/sessions/session_a/plugins/notes/shout": (body) => shout(body as { text: string }),
    "GET /api/projects/project_a/files": () => ({ listing: { workspacePath: "/w", repository: true, files: [], source: "git", truncated: false, readAt: 0 } }),
    "GET /api/sessions/live": () => ({ sessions: [], projects: [] }),
    "GET /api/projects/project_a/skills": () => ({ skills: [], commands: [] }),
  });
  const { host } = await mount(<Box initial={initial} enabled={enabled} onSend={(draft) => sent.push(draft)} />);
  await flush(() => calls.some((call) => call.route === "GET /api/plugins"));
  await flush();
  const editor = host.querySelector<HTMLElement>("[data-slot=composer-editor]")!;
  act(() => {
    editor.focus();
    editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  const caretAt = (node: Node, offset: number) => {
    window.getSelection()!.collapse(node, offset);
    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }));
    });
  };
  const caretAtEnd = () => {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  };
  const key = (init: KeyboardEventInit) =>
    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    });
  return { host, editor, sent, calls, caretAt, caretAtEnd, key };
}

const decorated = (editor: HTMLElement, style: string) => [...editor.querySelectorAll(`[data-decoration=${style}]`)].map((span) => span.textContent);

test("an enabled plugin's pattern is drawn, but never inside code", async () => {
  const { editor } = await composer("see #12 and `#13` then #14");
  expect(decorated(editor, "accent")).toEqual(["#12", "#14"]);
  expect(editor.querySelector("[data-md=code]")?.textContent).toBe("#13");
});

test("a plugin the project did not turn on contributes nothing", async () => {
  const { editor, host } = await composer("see #12", undefined, ["other"]);
  expect(decorated(editor, "accent")).toEqual([]);
  expect(host.querySelector("[data-slot=plugin-command-status]")).toBeNull();
});

test("/ lists the plugin's command under its own heading", async () => {
  const { host, editor } = await composer("");
  const text = document.createTextNode("/sh");
  editor.replaceChildren(text);
  window.getSelection()!.collapse(text, 3);
  act(() => {
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "h" }));
  });
  await flush(() => Boolean(host.querySelector('[role="listbox"]')?.textContent?.includes("/shout")));
  const menu = host.querySelector('[role="listbox"]')!;
  expect(menu.textContent).toContain("Plugin commands");
  expect(menu.textContent).toContain("Say it louder · what to say");
});

test("Enter on a command line calls its route, shows it running, puts the answer in its place, and undo brings the command back", async () => {
  let release: (() => void) | undefined;
  const { editor, host, sent, calls, caretAtEnd, key } = await composer("Note:\n/shout hello there");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/plugins/notes/shout")) await new Promise<void>((resolve) => (release = resolve));
    return realFetch(input, init);
  }) as typeof fetch;
  caretAtEnd();
  key({ key: "Enter" });
  await flush(() => release !== undefined);
  expect(host.querySelector("[data-slot=plugin-command-status]")?.textContent).toBe("Running /shout…");
  await act(async () => release!());
  await flush(() => host.querySelector("[data-slot=plugin-command-status]") === null);
  expect(calls.find((call) => call.route.endsWith("/shout"))?.body).toEqual({ text: "hello there" });
  expect(editor.textContent).toBe("Note:HELLO THERE!");
  expect(sent).toEqual([]);
  key({ key: "z", metaKey: true });
  expect(editor.textContent).toBe("Note:/shout hello there");
});

test("a failing command says why and leaves the draft as typed", async () => {
  const { editor, host, caretAtEnd, key } = await composer("/shout hi", () => {
    throw new Error("the model is busy");
  });
  caretAtEnd();
  key({ key: "Enter" });
  await flush(() => Boolean(host.querySelector("[data-slot=plugin-command-status]")?.textContent?.includes("busy")));
  expect(host.querySelector("[data-slot=plugin-command-status]")?.textContent).toContain("/shout:");
  expect(editor.textContent).toBe("/shout hi");
});

test("with the caret in a math decoration, KaTeX previews it above the box", async () => {
  const { editor, host, caretAt } = await composer("so $x^2$ ok");
  const math = editor.querySelector("[data-decoration=math]")!;
  expect(math.textContent).toBe("$x^2$");
  caretAt(math.firstChild!, 2);
  await flush(() => host.querySelector("[data-slot=decoration-preview-math] .katex") !== null);
  expect(host.querySelector("[data-slot=decoration-preview-math] .katex")).not.toBeNull();
  caretAt(editor.lastChild!, 1);
  expect(host.querySelector("[data-slot=decoration-preview]")).toBeNull();
});
