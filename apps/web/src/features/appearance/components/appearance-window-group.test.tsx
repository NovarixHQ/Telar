import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { Composer } from "@/features/composer";
import { ConversationMessage } from "@/features/transcript";
import { buttonLabelled, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { APPEARANCE_INIT_SCRIPT, useAppearance } from "../appearance";
import { AppearanceProvider } from "./appearance-provider";
import { AppearanceWindowGroup } from "./appearance-window-group";

installTestDom();

const globals = fs.readFileSync(path.join(fileURLToPath(new URL(".", import.meta.url)), "../../../app/globals.css"), "utf8");
const chatWidthRules = globals.match(/(?::root|\[data-chat-width="\w+"\]) \{\s*--chat-content-max-width:[^}]*\}/g)!.join("\n");

function Settings() {
  const { appearance, setAppearance } = useAppearance();
  return <AppearanceWindowGroup appearance={appearance} setAppearance={setAppearance} />;
}

async function cockpit() {
  stubFetch({});
  const { host, unmount } = await mount(
    <AppearanceProvider>
      <Settings />
      <ConversationMessage text="Mock up the landing page" />
      <Composer
        draft=""
        ready
        attachments={[]}
        onAttach={() => {}}
        busy={false}
        driver="claude"
        sending={false}
        backgroundTasks={0}
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onStop={() => {}}
        onStopBackground={() => {}}
        onRuntimeMode={() => {}}
      />
    </AppearanceProvider>,
  );
  await flush();
  const classes = new Set([...host.querySelectorAll("[class]")].flatMap((element) => element.getAttribute("class")!.split(/\s+/)));
  const compiler = await compile(`@tailwind utilities;\n${chatWidthRules}`);
  const style = document.createElement("style");
  style.textContent = compiler.build([...classes]);
  document.head.append(style);
  const measure = (start: Element) => {
    for (let element: Element | null = start; element; element = element.parentElement) {
      const width = getComputedStyle(element).maxWidth;
      if (width && width !== "none") return width;
    }
    return "none";
  };
  return {
    unmount,
    composer: () => measure(host.querySelector("[data-slot=composer-editor]")!),
    transcript: () => measure(host.querySelector("[data-role=user]")!),
    remove: () => style.remove(),
  };
}

let view: Awaited<ReturnType<typeof cockpit>> | undefined;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-chat-width");
});

afterEach(() => {
  view?.remove();
  view = undefined;
});

describe("chat width", () => {
  test("comfortable keeps the transcript and the composer at the 800px column", async () => {
    view = await cockpit();
    expect(buttonLabelled("Comfortable")!.getAttribute("aria-pressed")).toBe("true");
    expect(view.transcript()).toBe("800px");
    expect(view.composer()).toBe("800px");
  });

  test("wide and full widen the transcript and the composer together", async () => {
    view = await cockpit();
    await click(buttonLabelled("Wide"));
    expect(document.documentElement.getAttribute("data-chat-width")).toBe("wide");
    expect(view.transcript()).toBe("1152px");
    expect(view.composer()).toBe("1152px");

    await click(buttonLabelled("Full"));
    expect(view.transcript()).toBe("100%");
    expect(view.composer()).toBe("100%");

    await click(buttonLabelled("Comfortable"));
    expect(document.documentElement.hasAttribute("data-chat-width")).toBe(false);
    expect(view.composer()).toBe("800px");
  });

  test("the choice survives a reload, before the first paint", async () => {
    view = await cockpit();
    await click(buttonLabelled("Wide"));
    view.unmount();
    document.documentElement.removeAttribute("data-chat-width");

    new Function(APPEARANCE_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-chat-width")).toBe("wide");

    view.remove();
    view = await cockpit();
    expect(buttonLabelled("Wide")!.getAttribute("aria-pressed")).toBe("true");
    expect(view.composer()).toBe("1152px");
  });
});
