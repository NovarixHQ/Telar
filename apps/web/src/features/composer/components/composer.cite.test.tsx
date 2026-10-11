import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { activeComposer } from "@/features/composer";
import { setExperiment } from "@/features/settings/experiments";
import { installTestDom, mount, flush, stubFetch } from "@/test/dom";
import { Composer } from "./composer";
import { CITE_PROJECTS_EXPERIMENT } from "../hooks/use-composer-completions";

installTestDom();

afterEach(() => setExperiment(CITE_PROJECTS_EXPERIMENT, false));

function Box() {
  const [draft, setDraft] = useState("");
  return (
    <>
      <p data-testid="draft">{draft}</p>
      <Composer
        draft={draft}
        ready
        attachments={[]}
        onAttach={() => {}}
        busy={false}
        driver="claude"
        sending={false}
        backgroundTasks={0}
        projectId="project_a"
        onDraftChange={setDraft}
        onSubmit={() => {}}
        onStop={() => {}}
        onStopBackground={() => {}}
        onRuntimeMode={() => {}}
      />
    </>
  );
}

const live = () => ({
  sessions: [{ id: "session_b", title: "Pair on the parser", projectId: "project_a", updatedAt: 1 }],
  projects: [
    { id: "project_a", name: "ozom", root: "/src/ozom" },
    { id: "project_core", name: "Telar core", root: "/src/telar" },
  ],
});
const files = () => ({ listing: { workspacePath: "/w", repository: true, files: ["README.md"], source: "git", truncated: false, readAt: 0 } });
const found = () => ({
  index: "fts5",
  more: false,
  sessions: [
    { id: "session_old", title: "Orchestrator wake", projectId: "project_a", activity: "idle", updatedAt: 10, why: "how the orchestrator wakes" },
    { id: "session_new", title: "Builder handoff", projectId: "project_a", activity: "idle", updatedAt: 20, why: "the orchestrator hands off" },
  ],
});

async function composer() {
  const calls = stubFetch({ "GET /api/projects/project_a/files": files, "GET /api/sessions/live": live, "GET /api/sessions/find": found });
  const { host } = await mount(<Box />);
  await flush();
  const editor = host.querySelector<HTMLElement>("[data-slot=composer-editor]")!;
  return { host, editor, calls, draft: () => host.querySelector('[data-testid="draft"]')!.textContent ?? "" };
}

async function type(editor: HTMLElement, text: string) {
  act(() => {
    editor.focus();
    editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  act(() => void activeComposer()!.replace(0, 0, text));
  await flush();
}

function key(target: Element, name: string) {
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name })));
}

const listbox = (host: HTMLElement) => host.querySelector('[role="listbox"]');
const rows = (host: HTMLElement) => [...(listbox(host)?.querySelectorAll('[role="option"]') ?? [])].map((row) => row.textContent ?? "");
const option = (host: HTMLElement, text: string) => [...listbox(host)!.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent?.includes(text))!;

describe("citing a project from @", () => {
  test("a project shows only when the text matches its name, after files and sessions", async () => {
    setExperiment(CITE_PROJECTS_EXPERIMENT, true);
    const { host, editor } = await composer();
    await type(editor, "@");
    await flush(() => rows(host).some((row) => row.includes("README.md")));
    expect(rows(host).some((row) => row.includes("Telar core"))).toBe(false);

    act(() => void activeComposer()!.replace(1, 1, "core"));
    await flush(() => rows(host).some((row) => row.includes("Telar core")));
    expect(rows(host).find((row) => row.includes("Telar core"))).toContain("Project");
    expect(rows(host).at(-1)).toBe('Search "core" in settled sessions');
  });

  test("picking a project inserts a reference that tells the agent how to search it", async () => {
    setExperiment(CITE_PROJECTS_EXPERIMENT, true);
    const { host, editor, draft } = await composer();
    await type(editor, "@telar");
    await flush(() => rows(host).some((row) => row.includes("Telar core")));
    act(() => option(host, "Telar core").click());
    await flush();
    expect(draft()).toContain('the "Telar core" project (project_core at /src/telar)');
    expect(draft()).toContain('sessions_list (q, projectId: "project_core")');
  });

  test("without the experiment no project is offered", async () => {
    const { host, editor } = await composer();
    await type(editor, "@telar");
    await flush(() => rows(host).some((row) => row.includes("settled sessions")));
    expect(rows(host).some((row) => row.includes("Telar core"))).toBe(false);
  });
});

describe("searching settled sessions from @", () => {
  test("a bare @ has no search row, and nothing is searched until it is chosen", async () => {
    const { host, editor, calls } = await composer();
    await type(editor, "@");
    await flush(() => rows(host).some((row) => row.includes("README.md")));
    expect(rows(host).some((row) => row.includes("settled sessions"))).toBe(false);

    act(() => void activeComposer()!.replace(1, 1, "orch"));
    await flush(() => rows(host).some((row) => row.includes("settled sessions")));
    expect(calls.some((call) => call.route === "GET /api/sessions/find")).toBe(false);
  });

  test("choosing the row lists settled matches newest first, and picking one inserts a session reference", async () => {
    const { host, editor, draft } = await composer();
    await type(editor, "@orchestrator");
    await flush(() => rows(host).some((row) => row.includes("settled sessions")));
    act(() => option(host, "in settled sessions").click());
    await flush(() => rows(host).some((row) => row.includes("Builder handoff")));
    expect(listbox(host)!.getAttribute("aria-label")).toBe("Settled sessions");
    expect(rows(host)[0]).toStartWith("Builder handoff");
    expect(rows(host)[1]).toStartWith("Orchestrator wake");

    act(() => option(host, "Orchestrator wake").click());
    await flush();
    expect(draft()).toStartWith('the "Orchestrator wake" session (session_old), as reference');
    expect(draft()).not.toContain("@orchestrator");
  });

  test("Esc and Backspace return to the normal list without touching the draft", async () => {
    const { host, editor, draft } = await composer();
    await type(editor, "@orchestrator");
    await flush(() => rows(host).some((row) => row.includes("settled sessions")));
    for (const name of ["Escape", "Backspace"]) {
      act(() => option(host, "in settled sessions").click());
      await flush(() => listbox(host)?.getAttribute("aria-label") === "Settled sessions");
      key(editor, name);
      await flush();
      expect(listbox(host)?.getAttribute("aria-label")).toBe("Files and folders");
      expect(draft()).toBe("@orchestrator");
    }
  });
});
