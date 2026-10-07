import { expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import { useCommandHandlers, useMenuCommands } from "./use-command-keys";

installTestDom();

test("a window with no rail runs what the shell's menu sends to it", async () => {
  let deliver: ((id: string) => void) | undefined;
  (window as { telarDesktop?: unknown }).telarDesktop = {
    commandKeys: { onInvoke: (listener: (id: string) => void) => { deliver = listener; return () => { deliver = undefined; }; } },
  };
  const ran: string[] = [];
  function Window() {
    useMenuCommands();
    useCommandHandlers({ "float-browser": () => ran.push("float-browser") });
    return null;
  }
  const { unmount } = await mount(<Window />);
  await act(async () => deliver?.("float-browser"));
  expect(ran).toEqual(["float-browser"]);

  unmount();
  expect(deliver).toBeUndefined();
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});
