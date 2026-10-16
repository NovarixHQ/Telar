import { afterAll, beforeEach, describe, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useState } from "react";
import { Composer } from "@/features/composer";
import { installDictationFakes, knobs, live, results, mounted, draftOf, chord } from "@/features/dictation/components/dictation-button-fakes";
import { flush } from "@/test/dom";
import { usePublishPanelFullscreen } from "@/features/panel";
import { MiniComposer } from "./mini-composer";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(async () => {
  await act(async () => {
    await new Promise((settle) => setTimeout(settle, 0));
  });
  await GlobalRegistrator.unregister();
});

installDictationFakes();
beforeEach(() => {
  knobs.reducedMotion = true;
});

let sends = 0;
let stops = 0;

function Fullscreen({ on }: { on: boolean }) {
  usePublishPanelFullscreen(on);
  return null;
}

function Cockpit({ start = "", busy = false }: { start?: string; busy?: boolean }) {
  const [draft, setDraft] = useState(start);
  const [fullscreen, setFullscreen] = useState(true);
  const props = {
    draft,
    ready: true,
    attachments: [],
    onAttach: () => {},
    busy,
    sending: false,
    backgroundTasks: 0,
    onDraftChange: setDraft,
    onSubmit: () => {
      sends += 1;
      setDraft("");
    },
    onStop: () => {
      stops += 1;
    },
    onStopBackground: () => {},
    onRuntimeMode: () => {},
  };
  return (
    <>
      <Fullscreen on={fullscreen} />
      <button type="button" onClick={() => setFullscreen(false)}>
        Exit fullscreen
      </button>
      <p data-testid="draft">{draft}</p>
      {fullscreen ? <MiniComposer composer={props} exchange={<p data-testid="exchange">The last reply</p>} /> : <Composer {...props} />}
    </>
  );
}

const floating = () => document.querySelector('[role="dialog"][aria-label="Message"]');
const editor = () => document.querySelector<HTMLElement>('[data-slot="composer-editor"]');
const key = (name: string) =>
  act(async () => {
    editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await new Promise((settle) => setTimeout(settle, 0));
  });

describe("with the panel filling the window, the dictation chord floats the session's composer", () => {
  test("⌘D floats the composer and dictates into the session's draft", async () => {
    const host = await mounted(<Cockpit start="Look at " />);
    expect(floating()).toBeNull();

    expect(await chord()).toBe(true);
    expect(floating()).not.toBeNull();
    live!.open();
    live!.say(results("the header", true));
    expect(draftOf(host)).toBe("Look at the header ");
  });

  test("dictation that hears nothing closes it", async () => {
    await mounted(<Cockpit />);
    await chord();
    live!.open();
    await chord();
    expect(floating()).toBeNull();
  });

  test("dictation that heard words leaves it open, and sending closes it", async () => {
    await mounted(<Cockpit />);
    await chord();
    live!.open();
    live!.say(results("ship it", true));
    await chord();
    expect(floating()).not.toBeNull();

    const before = sends;
    await key("Enter");
    expect(sends).toBe(before + 1);
    expect(floating()).toBeNull();
  });

  test("Esc closes it, and leaving fullscreen keeps the draft in the session's composer", async () => {
    const host = await mounted(<Cockpit start="half a thought" />);
    await chord();
    live!.open();
    await chord();
    await chord();
    expect(floating()).not.toBeNull();

    await key("Escape");
    expect(floating()).toBeNull();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Exit fullscreen")!.click());
    expect(draftOf(host)).toBe("half a thought");
    expect(editor()?.textContent).toBe("half a thought");
  });

  test("while a turn runs, Esc arms stop like the session's composer, and the second Esc stops it", async () => {
    knobs.provider = "off";
    await mounted(<Cockpit busy />);
    await chord();
    const before = stops;

    await key("Escape");
    expect(floating()).not.toBeNull();
    expect(stops).toBe(before);
    await key("Escape");
    expect(stops).toBe(before + 1);
    expect(floating()).not.toBeNull();
  });

  test("with dictation off, ⌘D still floats the composer, without listening", async () => {
    knobs.provider = "off";
    await mounted(<Cockpit />);
    expect(await chord()).toBe(true);
    expect(floating()).not.toBeNull();
    expect(live).toBeUndefined();
  });
});

const notch = () => document.querySelector<HTMLButtonElement>('button[aria-label="Write a message"]');
const pointerAt = (clientY: number) =>
  act(async () => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: window.innerWidth / 2, clientY, bubbles: true }));
  });

describe("with the panel filling the window, a message can be typed over it", () => {
  test("the chord opens the session's composer for typing, with the last exchange above it and nothing listening", async () => {
    knobs.provider = "deepgram";
    const { runCommand } = await import("@/features/commands");
    await mounted(<Cockpit start="draft kept" />);
    await act(async () => void runCommand("mini-composer"));
    expect(floating()).not.toBeNull();
    expect(document.querySelector('[data-testid="exchange"]')?.textContent).toBe("The last reply");
    expect(editor()?.textContent).toBe("draft kept");
    expect(live).toBeUndefined();
  });

  test("Enter sends and closes it; a press on the dimmed page behind closes it too", async () => {
    const { runCommand } = await import("@/features/commands");
    await mounted(<Cockpit start="ship it" />);
    await act(async () => void runCommand("mini-composer"));
    const before = sends;
    await key("Enter");
    expect(sends).toBe(before + 1);
    await flush(() => floating() === null);
    expect(floating()).toBeNull();

    await act(async () => void runCommand("mini-composer"));
    expect(floating()).not.toBeNull();
    await act(async () => {
      document.querySelector('[data-slot="mini-backdrop"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await new Promise((settle) => setTimeout(settle, 0));
    });
    await flush(() => floating() === null);
    expect(floating()).toBeNull();
  });

  test("a notch shows near the bottom edge, hides a moment after the pointer leaves, and opens the composer", async () => {
    await mounted(<Cockpit />);
    expect(notch()).toBeNull();
    await pointerAt(window.innerHeight - 10);
    expect(notch()).not.toBeNull();

    jest.useFakeTimers();
    try {
      await pointerAt(window.innerHeight / 2);
      expect(notch()).not.toBeNull();
      await act(async () => void jest.advanceTimersByTime(500));
      expect(notch()).toBeNull();
    } finally {
      jest.useRealTimers();
    }

    await pointerAt(window.innerHeight - 5);
    await act(async () => notch()!.click());
    expect(floating()).not.toBeNull();
    expect(notch()).toBeNull();
  });

  test("the shell's report of the pointer at a browser page's bottom edge shows the notch too", async () => {
    let report: ((value: { near: boolean }) => void) | undefined;
    (window as { telarDesktop?: unknown }).telarDesktop = { browser: { onNearBottom: (listener: typeof report) => ((report = listener), () => (report = undefined)) } };
    try {
      await mounted(<Cockpit />);
      await act(async () => report?.({ near: true }));
      expect(notch()).not.toBeNull();
    } finally {
      delete (window as { telarDesktop?: unknown }).telarDesktop;
    }
  });
});

describe("the shell's write-to-the-agent chord, with this window in front", () => {
  test("over the full panel it opens the composer from the notch, and pressing it again only keeps it focused", async () => {
    const { focusComposerOnScreen } = await import("@/features/commands");
    await mounted(<Cockpit start="hello" />);
    let handled = false;
    await act(async () => void (handled = focusComposerOnScreen()));
    expect(handled).toBe(true);
    expect(floating()).not.toBeNull();
    expect(live).toBeUndefined();
    await flush(() => document.activeElement === editor());
    expect(document.activeElement).toBe(editor());

    await act(async () => void (handled = focusComposerOnScreen()));
    expect(handled).toBe(true);
    expect(floating()).not.toBeNull();
    expect(document.activeElement).toBe(editor());

    await key("Escape");
    await flush(() => floating() === null);
    expect(floating()).toBeNull();
  });

  test("out of fullscreen it focuses the session's own composer", async () => {
    const { focusComposerOnScreen } = await import("@/features/commands");
    const host = await mounted(<Cockpit />);
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Exit fullscreen")!.click());
    let handled = false;
    await act(async () => void (handled = focusComposerOnScreen()));
    expect(handled).toBe(true);
    expect(floating()).toBeNull();
    expect(document.activeElement).toBe(editor());
  });
});
