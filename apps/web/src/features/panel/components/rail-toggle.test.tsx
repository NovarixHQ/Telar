import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RailToggle } from "./rail-toggle";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

async function render(open: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onToggle = mock();
  await act(async () => createRoot(host).render(<RailToggle open={open} onToggle={onToggle} />));
  return { button: host.querySelector("button")!, onToggle };
}

test("stays in the header while the panel is open, pressed, and closes it", async () => {
  const { button, onToggle } = await render(true);
  expect(button.getAttribute("aria-label")).toBe("Close right panel");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button.click());
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test("opens the panel while it is closed", async () => {
  const { button } = await render(false);
  expect(button.getAttribute("aria-label")).toBe("Open right panel");
  expect(button.getAttribute("aria-pressed")).toBe("false");
});
