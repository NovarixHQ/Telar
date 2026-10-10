import { beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { UNKNOWN_PATH, type GitFileChange, type SessionDiff } from "@telar/engine-client";
import { installTestDom, mount, flush, click, stubFetch } from "@/test/dom";
import { fileReference, REFERENCE_MIME } from "@telar/client/composer";
import type { JournalItem, JournalTask } from "@telar/client/journal";
import type { DiffTab } from "@/features/git/diff-scope";
import { messagePlainText, quoteForComposer } from "@/ui/message";
import { DiffSurface, ReviewFileRow } from "@/features/git";
import { TranscriptItem } from "@/features/transcript";
import { Composer } from "@/features/composer";
import { DesktopBrowserSurface, type DesktopBrowserBridge, type DesktopBrowserPanelState, type DesktopBrowserTab } from "@/features/browser";
import { appendToDraft } from "@/features/sessions";

installTestDom();

let copied: string[] = [];
beforeEach(() => {
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
});

async function rightClick(target: Element) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 2 });
  await act(async () => void target.dispatchEvent(event));
  await flush();
  return event;
}
const menuRows = () => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
const labels = () => menuRows().map((row) => row.textContent?.trim());
const row = (label: string) => menuRows().find((each) => each.textContent?.trim() === label);
const disabled = (label: string) => row(label)?.hasAttribute("data-disabled");
const choose = (label: string) => click(row(label));
const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((node) => node.textContent?.trim() === text)!;
describe("the diff surface's file row", () => {
  const file: GitFileChange = { path: "src/a.ts", status: "modified" };
  const view = { layout: "stacked", wrap: false, ignoreWhitespace: false, tree: false } as const;

  async function fileRow(patch: Partial<Parameters<typeof ReviewFileRow>[0]> = {}) {
    const { host } = await mount(
      <ReviewFileRow readPatch={async () => ({ file: { patch: "", binary: false } })} file={file} reported view={view} open={false} onToggle={() => {}} {...patch} />,
    );
    await rightClick(host.querySelector("button")!);
    return host;
  }

  test("with every route wired it offers them all, and never stage, unstage or revert", async () => {
    await fileRow({ onOpenFile: () => {}, onOpenInNewPanelTab: () => {}, onInsertReference: () => {} });
    expect(labels()).toEqual(["Open in Editor", "Open in a new panel tab", "Copy path", "Insert as reference", "Expand patch"]);
  });

  test("with no routes it offers what the row can do alone", async () => {
    await fileRow({ open: true });
    expect(labels()).toEqual(["Copy path", "Collapse patch"]);
  });

  test("each item fires its route with the row's path", async () => {
    const seen: string[] = [];
    const host = await fileRow({
      onOpenFile: (at) => seen.push(`editor ${at}`),
      onOpenInNewPanelTab: (at) => seen.push(`tab ${at}`),
      onInsertReference: (text) => seen.push(`insert ${text}`),
      onToggle: () => seen.push("toggle"),
    });
    const trigger = host.querySelector("button")!;
    for (const label of ["Open in Editor", "Open in a new panel tab", "Insert as reference", "Expand patch", "Copy path"]) {
      await rightClick(trigger);
      await choose(label);
    }
    expect(seen).toEqual(["editor src/a.ts", "tab src/a.ts", "insert `src/a.ts`", "toggle"]);
    expect(copied).toEqual(["src/a.ts"]);
  });

  test("Insert as reference inserts the same text the row's own drag carries", async () => {
    let inserted = "";
    const host = await fileRow({ onInsertReference: (text) => (inserted = text) });
    await choose("Insert as reference");
    const data = new Map<string, string>();
    const drag = new Event("dragstart", { bubbles: true });
    Object.defineProperty(drag, "dataTransfer", { value: { setData: (type: string, value: string) => data.set(type, value), effectAllowed: "" } });
    await act(async () => void host.querySelector("[draggable]")!.dispatchEvent(drag));
    expect(inserted).toBe(fileReference(file.path).text);
    expect(data.get("text/plain")).toBe(inserted);
    expect(JSON.parse(data.get(REFERENCE_MIME)!).text).toBe(inserted);
  });
});

describe("the diff surface around its rows", () => {
  const diff: SessionDiff = {
    repository: true,
    workspacePath: "/w",
    files: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "added" }],
    commits: [],
    linesAdded: 0,
    linesRemoved: 0,
    truncated: false,
  };

  async function surface(tab: DiffTab, onTabChange: (tab: DiffTab) => void = () => {}) {
    stubFetch({ "GET /api/sessions/s1/diff": () => ({ diff }) });
    const opened: string[] = [];
    const { host } = await mount(
      <DiffSurface sessionId="s1" reported={new Map([["b.ts", 1]])} suggestion="Work" tab={tab} onTabChange={onTabChange} onOpenFile={(at) => opened.push(at)} />,
    );
    await flush(() => host.querySelectorAll("[data-diff-path]").length === 2);
    return { host, opened };
  }

  test("the unreported row and the reported row carry the same menu", async () => {
    const { host, opened } = await surface({ kind: "branch" });
    for (const at of ["a.ts", "b.ts"]) {
      await rightClick(host.querySelector(`[data-diff-path="${at}"] button`)!);
      expect(labels()).toEqual(["Open in Editor", "Copy path", "Collapse patch"]);
      await choose("Open in Editor");
    }
    expect(opened).toEqual(["a.ts", "b.ts"]);
  });

  test("the filter field rewrites the whole tab, and its clear button blanks the filter", async () => {
    const written: DiffTab[] = [];
    const { host } = await surface({ kind: "branch", base: "main", filter: "a" }, (tab) => written.push(tab));
    const field = host.querySelector('input[aria-label="Filter this review by path"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "src/");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(host.querySelector('button[aria-label="Clear the filter"]')!);
    expect(written).toEqual([{ kind: "branch", base: "main", filter: "src/" }, { kind: "branch", base: "main", filter: "" }]);
  });
});

describe("inserting into the composer's draft", () => {
  test("an empty draft becomes the insert, and a reference joins the sentence with one space", () => {
    expect(appendToDraft("  ", "`a.ts`")).toBe("`a.ts`");
    expect(appendToDraft("fix", "`a.ts`")).toBe("fix `a.ts` ");
    expect(appendToDraft("fix ", "`a.ts`")).toBe("fix `a.ts` ");
  });

  test("a multi-line insert is a paragraph of its own", () => {
    expect(appendToDraft("see this  \n", "> one\n> two")).toBe("see this\n\n> one\n> two");
  });
});

describe("the transcript's message and tool rows", () => {
  const base = { runId: "run_1", sessionId: "session_1", startedAt: 1, streamedText: "", openedBy: 0 } as const;
  const said = (type: "assistant_message" | "user_message", text: string, status: JournalItem["status"] = "completed") =>
    ({ ...base, id: "m", status, completedAt: 2, detail: { type, text } }) as unknown as JournalItem;
  const answer = "Use **this**:\n\n```\nconst *x* = 1;\n```";

  async function transcriptRow(item: JournalItem, gestures: Partial<Parameters<typeof TranscriptItem>[0]> = {}) {
    const { host } = await mount(<TranscriptItem item={item} {...gestures} />);
    const event = await rightClick(host.firstElementChild!);
    return { host, event };
  }

  test("an answer offers plain text, its Markdown, and a quote into the composer", async () => {
    const quoted: string[] = [];
    await transcriptRow(said("assistant_message", answer), { onInsert: (text) => quoted.push(text) });
    expect(labels()).toEqual(["Copy text", "Copy as Markdown", "Quote into composer"]);
    await choose("Copy text");
    await transcriptRow(said("assistant_message", answer));
    await choose("Copy as Markdown");
    expect(copied).toEqual([messagePlainText(answer), answer]);
    expect(copied[0]).toContain("const *x* = 1;");
    expect(copied[0]).toContain("Use this:");
  });

  test("Quote into composer hands the cockpit every line prefixed", async () => {
    const quoted: string[] = [];
    await transcriptRow(said("assistant_message", "one\n\ntwo"), { onInsert: (text) => quoted.push(text) });
    await choose("Quote into composer");
    expect(quoted).toEqual(["> one\n> \n> two"]);
    expect(quoteForComposer("  one\ntwo  ")).toBe("> one\n> two");
  });

  test("a person's message is plain, so it gets one copy item rather than two", async () => {
    await transcriptRow(said("user_message", "fix *it*"));
    expect(labels()).toEqual(["Copy text"]);
    await choose("Copy text");
    expect(copied).toEqual(["fix *it*"]);
  });

  test("an answer still streaming carries no menu", async () => {
    const { event } = await transcriptRow(said("assistant_message", "half a sen", "inProgress"));
    expect(menuRows()).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  test("a command row copies its command and output, and never offers to re-run", async () => {
    const item = { ...base, id: "c", status: "completed", completedAt: 2, detail: { type: "command_execution", command: { command: "ls -la", outputPreview: "a\nb" } } } as unknown as JournalItem;
    await transcriptRow(item);
    expect(labels()).toEqual(["Copy command", "Copy output"]);
    await choose("Copy command");
    expect(copied).toEqual(["ls -la"]);
  });

  test("a file row offers the file: open it, copy it, reference it", async () => {
    const seen: string[] = [];
    const item = { ...base, id: "f", status: "completed", completedAt: 2, title: "Edit", detail: { type: "file_change", change: { path: "src/a.ts", kind: "edit", unifiedDiff: "@@\n-a\n+b" } } } as unknown as JournalItem;
    const gestures = { onOpenFile: (at: string) => seen.push(`editor ${at}`), onOpenFileInNewTab: (at: string) => seen.push(`tab ${at}`), onInsert: (text: string) => seen.push(`insert ${text}`) };
    const { host } = await transcriptRow(item, gestures);
    expect(labels()).toEqual(["Copy patch", "Open file in the Editor", "Open in a new panel tab", "Copy path", "Insert as reference"]);
    for (const label of ["Open file in the Editor", "Open in a new panel tab", "Insert as reference", "Copy path", "Copy patch"]) {
      if (!row(label)) await rightClick(host.firstElementChild!);
      await choose(label);
    }
    expect(seen).toEqual(["editor src/a.ts", "tab src/a.ts", "insert `src/a.ts`"]);
    expect(copied).toEqual(["src/a.ts", "@@\n-a\n+b"]);
  });

  test("a row with nothing to offer — a file not yet named — gets no menu", async () => {
    const item = { ...base, id: "u", status: "inProgress", title: "Edit", detail: { type: "file_change", change: { path: UNKNOWN_PATH, kind: "edit" } } } as unknown as JournalItem;
    const { event } = await transcriptRow(item);
    expect(menuRows()).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  test("a sub-agent row's menu copies its report", async () => {
    const spawn = { ...base, id: "t", status: "completed", completedAt: 2, detail: { type: "task", taskId: "task_1" } } as unknown as JournalItem;
    const task = { id: "task_1", state: "completed", title: "Survey", role: "explorer", resultText: "Found it.", items: [] } as unknown as JournalTask;
    await transcriptRow(spawn, { tasks: [task] });
    expect(labels()).toEqual(["Copy text", "Copy as Markdown"]);
  });
});

describe("the composer's chrome, and the selection it leaves alone", () => {
  function Box({ initial = "", files = [], onAttach }: { initial?: string; files?: File[]; onAttach?: (files: File[]) => void }) {
    const [draft, setDraft] = useState(initial);
    return (
      <>
        <p data-testid="draft">{draft}</p>
        <Composer
          draft={draft}
          kind="session"
          ready
          attachments={files}
          onAttach={(next) => onAttach?.([...next])}
          busy={false}
          sending={false}
          backgroundTasks={0}
          onDraftChange={setDraft}
          onSubmit={() => {}}
          onStop={() => {}}
          onStopBackground={() => {}}
          onRuntimeMode={() => {}}
        />
      </>
    );
  }

  async function composer(props: Parameters<typeof Box>[0] = {}) {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
    const { host } = await mount(<Box {...props} />);
    await flush();
    const editor = host.querySelector('[contenteditable="true"]')!;
    return { host, editor, draft: () => host.querySelector('[data-testid="draft"]')!.textContent };
  }

  test("an empty box keeps both rows, disabled rather than hidden", async () => {
    const { editor } = await composer();
    await rightClick(editor);
    expect(labels()).toEqual(["Clear draft", "Stash draft"]);
    expect(disabled("Clear draft")).toBe(true);
    expect(disabled("Stash draft")).toBe(true);
  });

  test("the whole card answers, and Clear draft empties the box", async () => {
    const { host, draft } = await composer({ initial: "hello" });
    await rightClick(host.querySelector("[data-slot=input-group] button:last-of-type")!);
    expect(disabled("Clear draft")).toBe(false);
    expect(disabled("Stash draft")).toBe(false);
    await choose("Clear draft");
    expect(draft()).toBe("");
  });

  test("Stash draft takes the text off the box, as ⌘S does", async () => {
    const { editor, draft } = await composer({ initial: "later" });
    await rightClick(editor);
    await choose("Stash draft");
    expect(draft()).toBe("");
  });

  test("a picture alone is stashable, the same rule ⌘S uses", async () => {
    const { editor } = await composer({ files: [new File(["x"], "shot.png", { type: "image/png" })] });
    await rightClick(editor);
    expect(disabled("Clear draft")).toBe(true);
    expect(disabled("Stash draft")).toBe(false);
  });

  test("a chip adds Remove attachment, and removing takes only that file", async () => {
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];
    let attached: File[] = files;
    const { host } = await composer({ files, onAttach: (next) => (attached = next) });
    await rightClick(byText(host, "span", "b.txt"));
    expect(labels()).toEqual(["Remove attachment", "Clear draft", "Stash draft"]);
    await choose("Remove attachment");
    expect(attached.map((file) => file.name)).toEqual(["a.txt"]);
  });

  test("a right-click on selected text in the box leaves the browser's own menu alone", async () => {
    const { editor } = await composer({ initial: "select me" });
    const range = document.createRange();
    range.selectNodeContents(editor);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const event = await rightClick(editor.querySelector("*") ?? editor);
    window.getSelection()!.removeAllRanges();
    expect(menuRows()).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("the integrated browser's tab strip", () => {
  const tab = (index: number, patch: Partial<DesktopBrowserTab> = {}): DesktopBrowserTab => ({
    index,
    id: `tab_${index}`,
    title: `Page ${index}`,
    url: `https://example.com/${index}`,
    active: index === 0,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    zoom: 1,
    colorScheme: "system",
    viewport: { width: 1280, height: 800, preset: "default", mode: "fit" },
    ...patch,
  });

  async function strip(tabs: DesktopBrowserTab[], extra: Partial<DesktopBrowserBridge> = {}) {
    const state: DesktopBrowserPanelState = { scopeKey: "s", tabs, presentation: { width: 1280, height: 800, scale: 0.5, rect: { x: 0, y: 0, width: 640, height: 400 } } };
    const actions: Record<string, unknown>[] = [];
    const bridge: DesktopBrowserBridge = {
      getState: async () => state,
      action: async (_scope, action) => {
        actions.push(action);
        return state;
      },
      setBounds: async () => {},
      setVisible: async () => {},
      onState: () => () => {},
      ...extra,
    };
    const { host } = await mount(<DesktopBrowserSurface bridge={bridge} scopeKey="s" projectId="p" />);
    await flush(() => host.querySelectorAll('[role="tab"]').length === tabs.length);
    const menuOf = (index: number) => rightClick(host.querySelectorAll('[role="tab"]')[index]!);
    return { actions, menuOf };
  }

  test("every item names the right-clicked tab by index, and none selects it", async () => {
    const { actions, menuOf } = await strip([tab(0), tab(1)]);
    for (const label of ["Reload", "Duplicate", "Close"]) {
      await menuOf(1);
      await choose(label);
    }
    await menuOf(1);
    await choose("Copy URL");
    expect(actions).toEqual([{ action: "reload", index: 1 }, { action: "duplicate", index: 1 }, { action: "close", index: 1 }]);
    expect(copied).toEqual(["https://example.com/1"]);
  });

  test("Close others walks down, because closing renumbers the tabs above", async () => {
    const { actions, menuOf } = await strip([tab(0), tab(1), tab(2)]);
    await menuOf(1);
    await choose("Close others");
    await flush(() => actions.length === 2);
    expect(actions).toEqual([{ action: "close", index: 2 }, { action: "close", index: 0 }]);
  });

  test("Close others is disabled on a lone tab", async () => {
    const { menuOf } = await strip([tab(0)]);
    await menuOf(0);
    expect(disabled("Close others")).toBe(true);
  });

  test("Open in system browser is absent without the shell's door, and greyed on a non-web page", async () => {
    const plain = await strip([tab(0)]);
    await plain.menuOf(0);
    expect(labels()).not.toContain("Open in system browser");

    const sent: string[] = [];
    const openExternal = async (url: string) => (sent.push(url), { ok: true });
    const shell = await strip([tab(0), tab(1, { url: "about:blank" })], { openExternal });
    await shell.menuOf(0);
    await choose("Open in system browser");
    expect(sent).toEqual(["https://example.com/0"]);
    await shell.menuOf(1);
    expect(disabled("Open in system browser")).toBe(true);
  });
});
