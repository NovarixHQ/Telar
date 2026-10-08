import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { installTestDom, mount, flush, click, stubFetch } from "@/test/dom";
import { Composer } from "./composer";

installTestDom();

const layout = { height: 120, reduced: false, observers: new Set<() => void>() };
let animations: { target: HTMLElement; keyframes: Keyframe[] }[] = [];

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
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduced-motion") && layout.reduced, media: query })) as typeof window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => layout.height });
  HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes | null) {
    animations.push({ target: this, keyframes: keyframes as Keyframe[] });
    return { cancel() {} } as Animation;
  };
  HTMLElement.prototype.getAnimations = () => [];
});

beforeEach(() => {
  animations = [];
  stubFetch({});
});

afterEach(() => {
  Object.assign(layout, { height: 120, reduced: false });
});

function Box({ busy = false }: { busy?: boolean }) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(busy);
  return (
    <>
      <button type="button" onClick={() => setFiles((value) => (value.length ? [] : [new File(["x"], "notes.txt", { type: "text/plain" })]))}>
        attach
      </button>
      <button type="button" onClick={() => setRunning((value) => !value)}>
        run
      </button>
      <Composer
        draft={draft}
        ready
        attachments={files}
        onAttach={() => {}}
        busy={running}
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

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
const heights = () => animations.filter((run) => "height" in (run.keyframes[0] ?? {})).map((run) => run.keyframes.map((frame) => frame.height));

const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function settled(props: { busy?: boolean } = {}) {
  const { host } = await mount(<Box {...props} />);
  await flush();
  await frame();
  await flush();
  animations = [];
  return host;
}

describe("the composer's transitions", () => {
  test("attaching a file morphs the height from the old size to the new one", async () => {
    const host = await settled();
    layout.height = 168;
    await click(button(host, "attach"));
    expect(heights()).toEqual([["120px", "168px"]]);
    expect(host.textContent).toContain("notes.txt");
  });

  test("with reduced motion nothing animates, and the file still shows", async () => {
    layout.reduced = true;
    const host = await settled();
    layout.height = 168;
    await click(button(host, "attach"));
    expect(animations).toEqual([]);
    expect(host.textContent).toContain("notes.txt");
  });

  test("height that follows typed text is not animated", async () => {
    await settled();
    layout.height = 160;
    act(() => {
      for (const fire of [...layout.observers]) fire();
    });
    await flush();
    expect(animations).toEqual([]);
  });

  test("Send turning into Stop cross-fades the icon", async () => {
    const host = await settled();
    await click(button(host, "run"));
    expect(host.querySelector('button[aria-label="Stop"]')).not.toBeNull();
    expect(animations.some((run) => run.keyframes[0]?.transform === "scale(.6)")).toBe(true);
  });
});
