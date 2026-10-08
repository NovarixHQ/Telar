import { expect, test } from "bun:test";
import { act, useRef } from "react";
import { claimNativeView } from "@/platform/desktop/native-view-overlay";
import { flush, installTestDom, mount } from "@/test/dom";
import { useFrozenOverlay } from "./use-frozen-overlay";

installTestDom();

function harness({ hidden }: { hidden: boolean }) {
  const visible: boolean[] = [];
  const bridge = { setVisible: async (_scope: string, shown: boolean) => void visible.push(shown) };
  function Host() {
    const host = useRef<HTMLDivElement>(null);
    const overlay = useRef(false);
    useFrozenOverlay(bridge, "session_a", host, overlay);
    return (
      <div style={hidden ? { display: "none" } : {}}>
        <div ref={host} />
      </div>
    );
  }
  return { Host, visible };
}

async function openAndCloseAMenu() {
  let release = () => {};
  await act(async () => {
    release = claimNativeView();
  });
  await flush();
  await act(async () => release());
  await flush();
}

test("a menu closing over the browser puts the view back up", async () => {
  const { Host, visible } = harness({ hidden: false });
  await mount(<Host />);
  await openAndCloseAMenu();
  expect(visible).toEqual([false, true]);
});

test("a menu closing after another tab replaced the browser leaves the view down", async () => {
  const { Host, visible } = harness({ hidden: true });
  await mount(<Host />);
  await openAndCloseAMenu();
  expect(visible).toEqual([false]);
});
