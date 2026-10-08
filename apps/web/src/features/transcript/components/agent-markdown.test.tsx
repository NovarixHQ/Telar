import { expect, test } from "bun:test";
import { flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { AgentMarkdown } from "./agent-markdown";
import { ConversationMessage } from "./conversation-message";
import { TranscriptSession } from "./message-attachments";

installTestDom();

let sessions = 0;
const known = { "src/app/globals.css": "src/app/globals.css", "plan.md:42": "docs/plan.md" } as Record<string, string>;

function engine() {
  sessions += 1;
  return stubFetch({
    [`POST /api/sessions/session_${sessions}/files/references`]: (body) => ({
      references: (body as { texts: string[] }).texts
        .filter((text) => known[text])
        .map((text) => ({ text, path: known[text], ...(text.endsWith(":42") ? { line: 42 } : {}) })),
    }),
  });
}

const inSession = (children: React.ReactNode) => <TranscriptSession.Provider value={{ sessionId: `session_${sessions}` }}>{children}</TranscriptSession.Provider>;

test("inline code that names a file becomes a chip, the rest stays code, in one engine call", async () => {
  const calls = engine();
  const { host } = await mount(inSession(<AgentMarkdown text={"Edit `src/app/globals.css` and `plan.md:42`, then run `bun test` on `missing.ts`."} />));
  await flush(() => host.querySelectorAll("[title]").length === 2);
  const chips = [...host.querySelectorAll("[title]")];
  expect(chips.map((chip) => chip.textContent)).toEqual(["globals.css", "plan.md · L42"]);
  expect(chips.map((chip) => chip.getAttribute("title"))).toEqual(["src/app/globals.css", "docs/plan.md:42"]);
  expect([...host.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["bun test", "missing.ts"]);
  expect(calls.length).toBe(1);
  expect(calls[0]!.body).toEqual({ texts: ["src/app/globals.css", "plan.md:42", "missing.ts"] });
});

test("pressing a chip opens its file", async () => {
  engine();
  const opened: string[] = [];
  const { host } = await mount(inSession(<AgentMarkdown text="See `plan.md:42`." onOpenFile={(path) => opened.push(path)} />));
  await flush(() => host.querySelector("button") !== null);
  await press(host.querySelector("button")!);
  expect(opened).toEqual(["docs/plan.md"]);
});

test("a person's own message draws the same chip and opens the file's tab", async () => {
  engine();
  const opened: string[] = [];
  const { host } = await mount(inSession(<ConversationMessage text="why is `src/app/globals.css` red?" onOpenTab={(tab) => opened.push(tab)} />));
  await flush(() => host.querySelector("button") !== null);
  expect(host.textContent).toBe("why is globals.css red?");
  await press(host.querySelector("button")!);
  expect(opened).toEqual(["file:src/app/globals.css"]);
});

test("a message with no candidate never asks the engine", async () => {
  const calls = engine();
  const { host } = await mount(inSession(<AgentMarkdown text="Run `bun test` and `useState`." />));
  await flush();
  expect(calls).toEqual([]);
  expect(host.querySelectorAll("code").length).toBe(2);
});
