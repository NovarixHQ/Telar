import { expect, mock, test } from "bun:test";
import { act } from "react";
import { click, installTestDom, mount } from "@/test/dom";
import { QueuedMessages } from "./queued-messages";

installTestDom();

const MESSAGES = [
  { runId: "run_a", text: "First" },
  { runId: "run_b", text: "Second" },
  { runId: "run_c", text: "Third" },
];

function handlers() {
  return { onEdit: mock(), onMove: mock(), onRemove: mock(), onSendNow: mock() };
}

const rows = (host: HTMLElement) => [...host.querySelectorAll("li")];
const inRow = (row: Element, label: string) => row.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

test("renders the waiting messages in order, and nothing when there are none", async () => {
  const { host } = await mount(<QueuedMessages messages={MESSAGES} {...handlers()} />);
  expect(rows(host).map((row) => row.textContent)).toEqual(["First", "Second", "Third"]);
  const empty = await mount(<QueuedMessages messages={[]} {...handlers()} />);
  expect(empty.host.querySelector("ol")).toBeNull();
});

test("move up and down name the message they land before", async () => {
  const calls = handlers();
  const { host } = await mount(<QueuedMessages messages={MESSAGES} {...calls} />);
  const [first, second, third] = rows(host);
  expect(inRow(first!, "Move up").disabled).toBe(true);
  expect(inRow(third!, "Move down").disabled).toBe(true);
  await click(inRow(second!, "Move up"));
  await click(inRow(first!, "Move down"));
  await click(inRow(second!, "Move down"));
  expect(calls.onMove.mock.calls).toEqual([["run_b", "run_a"], ["run_a", "run_c"], ["run_b", null]]);
});

test("remove and send now act on their own row", async () => {
  const calls = handlers();
  const { host } = await mount(<QueuedMessages messages={MESSAGES} {...calls} />);
  await click(inRow(rows(host)[1]!, "Remove"));
  await click(inRow(rows(host)[2]!, "Send now"));
  expect(calls.onRemove.mock.calls).toEqual([["run_b"]]);
  expect(calls.onSendNow.mock.calls).toEqual([["run_c"]]);
});

test("send now is not offered without a handler", async () => {
  const { onSendNow: _, ...rest } = handlers();
  const { host } = await mount(<QueuedMessages messages={MESSAGES} {...rest} />);
  expect(host.querySelector('button[aria-label="Send now"]')).toBeNull();
});

test("edit saves on Enter, and Escape leaves the message as it was", async () => {
  const calls = handlers();
  const { host } = await mount(<QueuedMessages messages={MESSAGES} {...calls} />);
  const type = async (value: string, key: string) => {
    const box = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  };

  await click(inRow(rows(host)[0]!, "Edit"));
  await type("First, reworded", "Enter");
  expect(calls.onEdit.mock.calls).toEqual([["run_a", "First, reworded"]]);
  expect(host.querySelector("textarea")).toBeNull();

  await click(inRow(rows(host)[1]!, "Edit"));
  await type("Never mind", "Escape");
  expect(calls.onEdit.mock.calls).toHaveLength(1);
  expect(rows(host)[1]!.textContent).toBe("Second");
});
