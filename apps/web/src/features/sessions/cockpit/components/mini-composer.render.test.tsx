import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useState } from "react";
import { Composer } from "@/features/composer";
import { installDictationFakes, knobs, live, results, mounted, draftOf, chord } from "@/features/dictation/components/dictation-button-fakes";
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
      {fullscreen ? <MiniComposer {...props} /> : <Composer {...props} />}
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
