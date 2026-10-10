import { expect, test } from "bun:test";
import { act, useState } from "react";
import { installTestDom, mount, flush, stubFetch } from "@/test/dom";
import { Composer } from "./composer";

installTestDom();

function Box({ initial, onSend }: { initial: string; onSend: (draft: string) => void }) {
  const [draft, setDraft] = useState(initial);
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
      onDraftChange={setDraft}
      onSubmit={() => onSend(draft)}
      onStop={() => {}}
      onStopBackground={() => {}}
      onRuntimeMode={() => {}}
    />
  );
}

async function composer(initial: string) {
  const sent: string[] = [];
  stubFetch({
    "GET /api/projects/project_a/files": () => ({ listing: { workspacePath: "/w", repository: true, files: ["README.md"], source: "git", truncated: false, readAt: 0 } }),
    "GET /api/sessions/live": () => ({ sessions: [], projects: [] }),
  });
  const { host } = await mount(<Box initial={initial} onSend={(draft) => sent.push(draft)} />);
  await flush();
  const editor = host.querySelector<HTMLElement>("[data-slot=composer-editor]")!;
  act(() => {
    editor.focus();
    editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  return { host, editor, sent };
}

test("Enter sends the raw Markdown, markers and all", async () => {
  const draft = "# Plan\n- **bold** and `code` with [docs](https://x.dev)";
  const { editor, sent } = await composer(draft);
  expect(editor.querySelector("[data-md=strong]")?.textContent).toBe("bold");
  act(() => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(sent).toEqual([draft]);
});

test("@ inside bold text still opens the files menu", async () => {
  const { host, editor } = await composer("**see  now**");
  const bold = editor.querySelector("[data-md=strong]")!.firstChild!;
  bold.nodeValue = "see @ now";
  window.getSelection()!.collapse(bold, 5);
  act(() => {
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "@" }));
  });
  await flush(() => host.querySelector('[role="listbox"][aria-label="Files and folders"]')?.textContent?.includes("README.md") ?? false);
  expect(host.querySelector('[role="listbox"][aria-label="Files and folders"]')).not.toBeNull();
  expect([...editor.querySelectorAll("[data-md=strong]")].map((span) => span.textContent).join("")).toBe("see @ now");
});
