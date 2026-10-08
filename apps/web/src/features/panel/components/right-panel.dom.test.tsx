import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount, stubFetch } from "@/test/dom";
import { RightPanel } from "./right-panel";
import type { PanelTabItem } from "../model";

installTestDom();

const tab = (kind: string, id = kind): PanelTabItem => ({ id, kind, params: {} }) as PanelTabItem;

function panel(tabs: PanelTabItem[], extra: { onMoveTab?: (id: string, toIndex: number) => void } = {}) {
  return mount(
    <RightPanel
      sessionId="session_a"
      projectId="project_a"
      tabs={tabs}
      tab={tabs[0]!.id}
      onTabChange={() => {}}
      onOpenTab={() => {}}
      onCloseTab={() => {}}
     
      {...extra}
    />,
  );
}

describe("the panel's tabs drag to reorder", () => {
  function drag(type: string, target: Element, data: Map<string, string>, clientX = 0) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const dataTransfer = {
      get types() {
        return [...data.keys()];
      },
      setData: (format: string, value: string) => data.set(format, value),
      getData: (format: string) => data.get(format) ?? "",
      effectAllowed: "all",
      dropEffect: "none",
    };
    Object.assign(event, { dataTransfer, clientX });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  async function strip() {
    stubFetch({});
    const moves: [string, number][] = [];
    const { host } = await panel([tab("editor"), tab("issues"), tab("diff")], { onMoveTab: (id, to) => moves.push([id, to]) });
    const chips = [...host.querySelectorAll('[role="tablist"] > span')];
    return { chips, moves };
  }

  test("the chip is the handle, and none of the buttons inside it is", async () => {
    const { chips } = await strip();
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.getAttribute("draggable")).toBe("true");
      expect(chip.querySelectorAll("[draggable]")).toHaveLength(0);
    }
  });

  test("a drop asks for an index in the strip without the carried tab", async () => {
    const { chips, moves } = await strip();
    const data = new Map<string, string>();
    drag("dragstart", chips[0]!, data);
    drag("dragover", chips[2]!, data, 1);
    drag("drop", chips[2]!, data);
    expect(moves).toEqual([["editor", 2]]);

    const back = new Map<string, string>();
    drag("dragstart", chips[2]!, back);
    drag("dragover", chips[0]!, back, -1);
    drag("drop", chips[0]!, back);
    expect(moves.at(-1)).toEqual(["diff", 0]);
  });

  test("dropping a tab on itself moves nothing", async () => {
    const { chips, moves } = await strip();
    const data = new Map<string, string>();
    drag("dragstart", chips[1]!, data);
    drag("drop", chips[1]!, data);
    expect(moves).toEqual([]);
  });
});
