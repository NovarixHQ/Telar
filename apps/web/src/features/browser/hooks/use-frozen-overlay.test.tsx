import { expect, test } from "bun:test";
import { act, useRef } from "react";
import { claimNativeView } from "@/platform/desktop/native-view-overlay";
import { flush, installTestDom, mount } from "@/test/dom";
import { useFrozenOverlay } from "./use-frozen-overlay";

installTestDom();

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
const drawnAt = (box: DOMRect) => ({ getBoundingClientRect: () => box }) as Element;
const VIEW = rect(600, 40, 640, 400);
const FRAME = { data: "cG5n", mimeType: "image/png", rect: { x: 600, y: 40, width: 640, height: 400 } };

function harness({ hidden = false } = {}) {
  const calls: string[] = [];
  const bridge = {
    setVisible: async (_scope: string, visible: boolean) => {
      if (!visible) calls.push(document.querySelector("img") ? "hide over frame" : "hide");
      else calls.push("show");
    },
    captureView: async () => {
      calls.push("capture");
      return FRAME;
    },
  };
  function Host() {
    const host = useRef<HTMLDivElement>(null);
    const overlay = useRef(false);
    const frame = useFrozenOverlay(bridge, "session_a", host, overlay);
    return (
      <div style={hidden ? { display: "none" } : {}}>
        <div
          ref={(element) => {
            if (element) element.getBoundingClientRect = () => VIEW;
            host.current = element;
          }}
        >
          {frame && <img alt="" src={frame.src} />}
        </div>
      </div>
    );
  }
  return { Host, calls };
}

async function openAndClose(elements?: Set<Element>) {
  let release = () => {};
  await act(async () => {
    release = claimNativeView(elements);
  });
  await flush();
  await act(async () => release());
  await flush();
}

test("a menu over the browser is one capture, one hide once the frame is up, and one show", async () => {
  const { Host, calls } = harness();
  await mount(<Host />);
  await openAndClose(new Set([drawnAt(rect(560, 60, 200, 300))]));
  expect(calls).toEqual(["capture", "hide over frame", "show"]);
  expect(document.querySelector("img")).toBeNull();
});

test("a menu beside the browser leaves the view untouched", async () => {
  const { Host, calls } = harness();
  await mount(<Host />);
  await openAndClose(new Set([drawnAt(rect(10, 40, 200, 300))]));
  expect(calls).toEqual([]);
});

test("menus opened and closed within a frame never touch the view", async () => {
  const { Host, calls } = harness();
  await mount(<Host />);
  await act(async () => {
    for (let index = 0; index < 5; index += 1) claimNativeView()();
  });
  await flush();
  expect(calls).toEqual([]);
});

test("a menu closing after another tab replaced the browser leaves the view down", async () => {
  const { Host, calls } = harness({ hidden: true });
  await mount(<Host />);
  await openAndClose();
  expect(calls).toEqual(["capture", "hide over frame"]);
});
