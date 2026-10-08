import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import type { RuntimeMode, Session, UsageSnapshot } from "@telar/engine-client";
import { activeComposer } from "@/features/composer";
import { installTestDom, mount, flush, click, stubFetch } from "@/test/dom";
import { Composer } from "./composer";
import { draftAfterStash } from "../hooks/use-composer-stash";

installTestDom();

const STASH = "telar:prompt-stash:v1";
const storage = Object.getOwnPropertyDescriptor(window, "localStorage")!;

beforeEach(() => {
  localStorage.removeItem(STASH);
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", storage);
});

type BoxProps = {
  initial?: string;
  files?: File[];
  busy?: boolean;
  ready?: boolean;
  fresh?: boolean;
  projectId?: string;
  session?: Session;
  runtimeMode?: RuntimeMode;
  sentPrompts?: string[];
  usage?: UsageSnapshot;
  onSubmit?: () => void;
  onStop?: () => void;
};

function Box({ initial = "", files = [], busy = false, ready = true, fresh = false, projectId, session, runtimeMode, sentPrompts, usage, onSubmit = () => {}, onStop = () => {} }: BoxProps) {
  const [draft, setDraft] = useState(initial);
  const [attachments, setAttachments] = useState(files);
  return (
    <>
      <p data-testid="draft">{draft}</p>
      <Composer
        draft={draft}
        ready={ready}
        attachments={attachments}
        onAttach={setAttachments}
        busy={busy}
        fresh={fresh}
        driver="claude"
        sending={false}
        backgroundTasks={0}
        onDraftChange={setDraft}
        onSubmit={onSubmit}
        onStop={onStop}
        onStopBackground={() => {}}
        onRuntimeMode={() => {}}
        {...(projectId ? { projectId } : {})}
        {...(session ? { session } : {})}
        {...(runtimeMode ? { runtimeMode } : {})}
        {...(sentPrompts ? { sentPrompts } : {})}
        {...(usage ? { usage } : {})}
      />
    </>
  );
}

async function composer(props: BoxProps = {}, routes: Parameters<typeof stubFetch>[0] = {}) {
  const calls = stubFetch(routes);
  const { host } = await mount(<Box {...props} />);
  await flush();
  const editor = host.querySelector<HTMLElement>("[data-slot=composer-editor]")!;
  return {
    host,
    editor,
    calls,
    draft: () => host.querySelector('[data-testid="draft"]')!.textContent,
    stashList: () => host.querySelector('[role="listbox"][aria-label="Prompts waiting to be sent"]'),
  };
}

function key(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const saveChord = { key: "s", metaKey: true };

async function type(editor: HTMLElement, text: string) {
  act(() => {
    editor.focus();
    editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  const entry = activeComposer();
  if (!entry) throw new Error("no active composer");
  act(() => {
    entry.replace(0, 0, text);
  });
  await flush();
}

const layout = { width: 0, observers: new Set<() => void>() };

beforeAll(() => {
  globalThis.ResizeObserver = class {
    readonly fire: () => void;
    constructor(callback: () => void) {
      this.fire = () => callback();
    }
    observe() {
      layout.observers.add(this.fire);
    }
    unobserve() {}
    disconnect() {
      layout.observers.delete(this.fire);
    }
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => layout.width });
});

afterEach(() => {
  layout.width = 0;
});

async function narrowable(props: BoxProps, width: number) {
  layout.width = width;
  const mounted = await composer(props);
  const resize = async (next: number) => {
    layout.width = next;
    act(() => {
      for (const fire of [...layout.observers]) fire();
    });
    await flush();
  };
  return { ...mounted, resize };
}

const stashed = () => JSON.parse(localStorage.getItem(STASH) ?? "[]") as { prompt: string }[];

describe("⌘S", () => {
  test("with words in the box stashes them, clears the box, and never lets the Save dialog open", async () => {
    const { editor, draft } = await composer({ initial: "later" });
    const event = key(editor, saveChord);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(draft()).toBe("");
    expect(stashed().map((entry) => entry.prompt)).toEqual(["later"]);
  });

  test("takes a file with the words and gives both back on restore", async () => {
    const pdf = new File(["%PDF notes"], "notes.pdf", { type: "application/pdf" });
    const { host, editor, draft, stashList } = await composer({ initial: "read this", files: [pdf] });
    key(editor, saveChord);
    await flush(() => stashed().length > 0);
    expect(draft()).toBe("");
    expect(host.textContent).not.toContain("notes.pdf");
    key(editor, saveChord);
    await flush();
    const row = [...stashList()!.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("read this"))!;
    await act(async () => row.querySelector("button")!.click());
    await flush(() => Boolean(host.textContent?.includes("notes.pdf")));
    expect(draft()).toBe("read this");
    expect(host.textContent).toContain("notes.pdf");
  });

  test("on an empty box opens the stash list, and is still prevented", async () => {
    const { editor, stashList } = await composer();
    const event = key(editor, saveChord);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(stashList()?.textContent).toContain("Nothing stashed");
  });

  test("during an IME composition belongs to the IME", async () => {
    const { editor, draft } = await composer({ initial: "later" });
    const event = key(editor, { ...saveChord, isComposing: true });
    await flush();
    expect(event.defaultPrevented).toBe(false);
    expect(draft()).toBe("later");
    expect(stashed()).toEqual([]);
  });

  test("wins over an open completion menu", async () => {
    const { host, editor, draft } = await composer({ fresh: true });
    await type(editor, "/");
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    key(editor, saveChord);
    await flush();
    expect(draft()).toBe("");
    expect(stashed().map((entry) => entry.prompt)).toEqual(["/"]);
  });
});

describe("an attachment thumbnail", () => {
  test("enlarges the picked image when clicked", async () => {
    const png = new File(["png"], "shot.png", { type: "image/png" });
    const { host } = await composer({ files: [png] });
    expect(document.querySelector('[role="dialog"] img[alt="shot.png"]')).toBeNull();
    await click(host.querySelector('[aria-label="Enlarge shot.png"]')!);
    await flush(() => Boolean(document.querySelector('[role="dialog"]')));
    expect(document.querySelector('[role="dialog"] img[alt="shot.png"]')).not.toBeNull();
  });

  test("is not a button for a file that is not an image", async () => {
    const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    const { host } = await composer({ files: [pdf] });
    expect(host.querySelector('[aria-label="Enlarge notes.pdf"]')).toBeNull();
  });
});

describe("prompt recall", () => {
  const sentPrompts = ["first", "second"];

  test("↑ in an empty box walks back through sent prompts, and ↓ walks forward to the empty draft", async () => {
    const { editor, draft } = await composer({ sentPrompts });
    expect(key(editor, { key: "ArrowUp" }).defaultPrevented).toBe(true);
    await flush();
    expect(draft()).toBe("second");
    key(editor, { key: "ArrowUp" });
    await flush();
    expect(draft()).toBe("first");
    key(editor, { key: "ArrowDown" });
    await flush();
    expect(draft()).toBe("second");
    key(editor, { key: "ArrowDown" });
    await flush();
    expect(draft()).toBe("");
    expect(key(editor, { key: "ArrowDown" }).defaultPrevented).toBe(false);
  });

  test("↑ with words in the box moves the caret instead", async () => {
    const { editor, draft } = await composer({ initial: "typing", sentPrompts });
    expect(key(editor, { key: "ArrowUp" }).defaultPrevented).toBe(false);
    await flush();
    expect(draft()).toBe("typing");
  });

  test("an edited recall stops browsing", async () => {
    const { editor, draft } = await composer({ sentPrompts });
    key(editor, { key: "ArrowUp" });
    await flush();
    await type(editor, "x");
    expect(draft()).toBe("xsecond");
    expect(key(editor, { key: "ArrowUp" }).defaultPrevented).toBe(false);
  });
});

describe("the stash list", () => {
  test("Escape closes it even when it is empty", async () => {
    const { editor, stashList } = await composer();
    key(editor, saveChord);
    await flush();
    expect(stashList()).not.toBeNull();
    const event = key(editor, { key: "Escape" });
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(stashList()).toBeNull();
  });

  test("nothing it adds is disabled, so the composer is never greyed", async () => {
    localStorage.setItem(STASH, JSON.stringify([{ id: "one", at: Date.now(), prompt: "kept for later", images: [] }]));
    const { host, editor, stashList } = await composer();
    const badge = host.querySelector<HTMLElement>('[aria-label="Stashed prompts"]');
    expect(badge).not.toBeNull();
    key(editor, saveChord);
    await flush();
    expect(stashList()?.textContent).toContain("kept for later");
    expect(host.querySelector("[disabled], [aria-disabled=true]")).toBeNull();
  });
});

describe("the box is cleared only by a write that landed", () => {
  test("a refused write says so and takes nothing from the box", async () => {
    const full = { getItem: () => null, removeItem: () => {}, setItem: () => {
      throw new Error("quota");
    } };
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => full });
    const { host, editor, draft } = await composer({ initial: "important paragraph" });
    key(editor, saveChord);
    await flush();
    expect(draft()).toBe("important paragraph");
    expect(host.textContent).toContain("There was no room to stash this. Nothing was taken from the box.");
  });

  test("what was typed during an encode is not part of what is cleared", () => {
    expect(draftAfterStash("draft and more", "draft")).toBe(" and more");
    expect(draftAfterStash("draft", "draft")).toBe("");
    expect(draftAfterStash("rewritten", "draft")).toBe("");
  });
});

describe("the skills menu", () => {
  const skills = () => ({ skills: [{ name: "deploy", description: "Ship it" }], commands: [] });

  test("a canvas with no session asks the project", async () => {
    const { editor, calls } = await composer({ projectId: "project_a" }, { "GET /api/projects/project_a/skills": skills });
    await type(editor, "$");
    await flush(() => calls.some((call) => call.route.endsWith("/skills")));
    expect(calls.map((call) => call.route)).toContain("GET /api/projects/project_a/skills");
  });

  test("a session asks itself, not the project", async () => {
    const session = { id: "session_a", driver: "claude", projectId: "project_a", workspace: { mode: "local", path: "/work" } } as Session;
    const { editor, calls } = await composer({ projectId: "project_a", session }, { "GET /api/sessions/session_a/skills": skills });
    await type(editor, "$");
    await flush(() => calls.some((call) => call.route.endsWith("/skills")));
    const routes = calls.map((call) => call.route);
    expect(routes).toContain("GET /api/sessions/session_a/skills");
    expect(routes).not.toContain("GET /api/projects/project_a/skills");
  });
});

describe("the @ menu", () => {
  const listing = (files: string[]) => () => ({ listing: { workspacePath: "/w", repository: true, files, source: "git", truncated: false, readAt: 0 } });
  const live = () => ({ sessions: [], projects: [] });
  const menu = (host: HTMLElement) => host.querySelector('[role="listbox"][aria-label="Files and folders"]');

  test("offers the project's files and folders", async () => {
    const { host, editor } = await composer({ projectId: "project_a" }, { "GET /api/projects/project_a/files": listing(["README.md", "src/app.ts"]), "GET /api/sessions/live": live });
    await type(editor, "@");
    await flush(() => menu(host)?.textContent?.includes("README.md") ?? false);
    expect(menu(host)?.textContent).toContain("src");
  });

  test("with nothing to offer it still opens and says so", async () => {
    const { host, editor } = await composer({ projectId: "project_a" }, { "GET /api/projects/project_a/files": listing([]), "GET /api/sessions/live": live });
    await type(editor, "@");
    await flush(() => menu(host)?.textContent?.includes("No matches.") ?? false);
    expect(menu(host)).not.toBeNull();
  });

  test("a listing that failed says so, and the next @ asks again", async () => {
    let answer: () => unknown = () => {
      throw new Error("git timed out");
    };
    const { host, editor, calls } = await composer({ projectId: "project_a" }, { "GET /api/projects/project_a/files": () => answer(), "GET /api/sessions/live": live });
    await type(editor, "@");
    await flush(() => menu(host)?.textContent?.includes("Could not read the files here.") ?? false);

    answer = listing(["README.md"]);
    act(() => void activeComposer()!.replace(0, 1, ""));
    await flush();
    await type(editor, "@");
    await flush(() => menu(host)?.textContent?.includes("README.md") ?? false);
    expect(calls.filter((call) => call.route === "GET /api/projects/project_a/files")).toHaveLength(2);
  });
});

describe("the corner button is Stop only while a running turn has nothing typed", () => {
  const corner = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Stop"], button[aria-label="Send"]')!;

  test("an empty box during a turn stops it", async () => {
    let stops = 0;
    let sends = 0;
    const { host } = await composer({ busy: true, onStop: () => stops++, onSubmit: () => sends++ });
    expect(corner(host).getAttribute("aria-label")).toBe("Stop");
    await click(corner(host));
    expect([stops, sends]).toEqual([1, 0]);
  });

  test("a draft during a turn turns it back into Send, so a steer can be clicked", async () => {
    let stops = 0;
    let sends = 0;
    const { host } = await composer({ initial: "steer left", busy: true, onStop: () => stops++, onSubmit: () => sends++ });
    expect(corner(host).getAttribute("aria-label")).toBe("Send");
    await click(corner(host));
    expect([stops, sends]).toEqual([0, 1]);
  });

  test("a picture with no words is a message", async () => {
    let sends = 0;
    const { host } = await composer({ busy: true, files: [new File(["x"], "shot.png", { type: "image/png" })], onSubmit: () => sends++ });
    expect(corner(host).getAttribute("aria-label")).toBe("Send");
    await click(corner(host));
    expect(sends).toBe(1);
  });

  test("with nothing typed and no turn running, Send sends nothing", async () => {
    let sends = 0;
    const { host } = await composer({ onSubmit: () => sends++ });
    await click(corner(host));
    expect(sends).toBe(0);
  });
});

describe("what the corner button and the empty box say", () => {
  const send = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  const tooltip = async (button: HTMLElement) => {
    act(() => button.focus());
    await flush(() => document.querySelector("[data-slot=tooltip-content]") !== null);
    return document.querySelector("[data-slot=tooltip-content]")?.textContent;
  };

  test("the empty box names its triggers", async () => {
    const { host } = await composer();
    expect(host.textContent).toContain("@ to reference");
    expect(host.textContent).toContain("/ for commands");
  });

  test("Send's tooltip says why a press would not send", async () => {
    const { host } = await composer({ initial: "go", ready: false });
    expect(await tooltip(send(host))).toBe("This session is not ready yet.");
  });

  test("a ready Send's tooltip just names it", async () => {
    const { host } = await composer({ initial: "go" });
    expect(await tooltip(send(host))).toBe("Send");
  });
});

describe("a narrow column, such as one beside an open panel", () => {
  const session = { id: "session_a", driver: "claude", projectId: "project_a", workspace: { mode: "local", path: "/work" } } as Session;
  const row = (host: HTMLElement) => host.querySelector("[data-slot=composer-controls]");
  const tray = (host: HTMLElement) => host.querySelector("[data-slot=composer-foot]")!;

  test("keeps the full composer with model, reasoning and access in the toolbar row", async () => {
    const { host, editor } = await narrowable({ session, runtimeMode: "full-access" }, 320);
    expect(editor.style.maxHeight).toBe("");
    expect(row(host)?.querySelector('[aria-label^="Model:"]')).not.toBeNull();
    expect(row(host)?.querySelector('[aria-label^="Reasoning effort:"]')).not.toBeNull();
    expect(row(host)?.querySelector('[aria-label^="Access:"]')).not.toBeNull();
    expect(tray(host).querySelector('[aria-label^="Model:"]')).toBeNull();
    expect(host.querySelector('[aria-label="More composer settings"]')).toBeNull();
  });

  test("narrowing a wide composer leaves the controls where they were, with the draft and focus", async () => {
    const { host, editor, resize } = await narrowable({ session, initial: "half a thought" }, 2000);
    act(() => editor.focus());
    await resize(320);
    expect(row(host)?.querySelector('[aria-label^="Model:"]')).not.toBeNull();
    expect(editor.textContent).toBe("half a thought");
    expect(document.activeElement).toBe(editor);
  });

  test("a new conversation's canvas stays full too", async () => {
    const { host } = await narrowable({ fresh: true }, 320);
    expect(row(host)?.querySelector('[aria-label^="Model:"]')).not.toBeNull();
  });
});

describe("the access pill", () => {
  const session = { id: "session_a", driver: "claude", projectId: "project_a", workspace: { mode: "local", path: "/work" } } as Session;
  const pill = (host: HTMLElement) => host.querySelector<HTMLElement>('[aria-label^="Access:"]')!;

  test("names the access level in effect", async () => {
    expect(pill((await composer({ session, runtimeMode: "full-access" })).host).textContent).toContain("Full access");
  });

  test("auto says what it is, so it never reads as the reasoning pill's Auto", async () => {
    expect(pill((await composer({ session, runtimeMode: "auto" })).host).textContent).toContain("Auto access");
  });

  test("its menu is only access", async () => {
    const { host } = await composer({ session, runtimeMode: "full-access" });
    await click(pill(host));
    expect(document.body.textContent).toContain("Supervised");
    expect(document.body.textContent).not.toContain("Usage limits");
  });
});

describe("the / menu opens the pills' pickers", () => {
  const session = { id: "session_a", driver: "claude", projectId: "project_a", workspace: { mode: "local", path: "/work" } } as Session;
  const options = (host: HTMLElement) => [...host.querySelectorAll('[role="listbox"] [role="option"]')].map((row) => row.textContent ?? "");
  const pill = (label: string) => document.querySelector<HTMLElement>(`[aria-label^="${label}:"]`);

  test("model and access are one row each", async () => {
    const { host, editor } = await composer({ session, runtimeMode: "full-access" });
    await type(editor, "/");
    expect(options(host).filter((row) => row.startsWith("/model"))).toHaveLength(1);
    expect(options(host).filter((row) => row.startsWith("/access"))).toHaveLength(1);
    expect(options(host).some((row) => row.startsWith("/full-access"))).toBe(false);
  });

  for (const [command, label] of [["/access", "Access"], ["/model", "Model"]] as const) {
    test(`${command} clears the box and opens the ${label.toLowerCase()} picker`, async () => {
      const { editor, draft } = await composer({ session, runtimeMode: "full-access" });
      await type(editor, command);
      expect(pill(label)?.getAttribute("aria-expanded")).not.toBe("true");
      key(editor, { key: "Enter" });
      await flush();
      expect(draft()).toBe("");
      expect(pill(label)?.getAttribute("aria-expanded")).toBe("true");
    });
  }
});

describe("the context ring", () => {
  const usage: UsageSnapshot = { tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0 }, contextUsed: 73_000, contextMax: 200_000 };
  const ring = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label^="Context window"]')!;

  test("an idle session with a known figure draws a still fill at its share, and nothing that loads", async () => {
    const { host } = await composer({ usage });
    expect(ring(host).getAttribute("aria-label")).toBe("Context window 36.5% used");
    expect(ring(host).querySelector("svg animate, svg animateTransform")).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    const fill = ring(host).querySelector<SVGCircleElement>('[data-testid="context-fill"]')!;
    const circumference = 2 * Math.PI * 11;
    expect(Number(fill.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * (1 - 0.365), 3);
  });

  test("a figure the provider never reported draws the empty track, not a partial arc", async () => {
    const { host } = await composer();
    expect(ring(host).getAttribute("aria-label")).toBe("Context window, size not reported");
    expect(ring(host).querySelector('[data-testid="context-fill"]')).toBeNull();
  });
});
