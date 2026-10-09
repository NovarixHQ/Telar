import { expect, test } from "bun:test";
import type { NativeKeyCommand } from "../../../modules/key-commands";
import { createKeyCommands } from "./key-commands";

function setup() {
  const published: NativeKeyCommand[][] = [];
  const registry = createKeyCommands((commands) => published.push(commands));
  return { registry, latest: () => published.at(-1) ?? [] };
}

test("each command carries the Swift app's keys and overlay title", () => {
  const { registry, latest } = setup();
  for (const id of ["newSession", "settings", "togglePanel", "leaveFullScreen"] as const) registry.bind({}, { id, run: () => {} });
  expect(latest()).toEqual([
    { id: "newSession", input: "n", modifiers: ["command"], title: "New conversation" },
    { id: "settings", input: ",", modifiers: ["command"], title: "Settings" },
    { id: "togglePanel", input: "i", modifiers: ["command", "option"], title: "Show panel" },
    { id: "leaveFullScreen", input: "escape", modifiers: [] },
  ]);
});

test("a binding can retitle its command, as the panel toggle does once the panel is open", () => {
  const { registry, latest } = setup();
  const owner = {};
  registry.bind(owner, { id: "togglePanel", run: () => {}, title: "Show panel" });
  registry.bind(owner, { id: "togglePanel", run: () => {}, title: "Hide panel" });
  expect(latest()).toEqual([{ id: "togglePanel", input: "i", modifiers: ["command", "option"], title: "Hide panel" }]);
});

test("a key press runs the latest binding of its command and nothing else", () => {
  const { registry } = setup();
  const ran: string[] = [];
  registry.bind({}, { id: "newSession", run: () => ran.push("new") });
  registry.bind({}, { id: "settings", run: () => ran.push("settings") });
  registry.dispatch("settings");
  registry.dispatch("unknown");
  expect(ran).toEqual(["settings"]);
});

test("unbinding hands the command back to the screen underneath, then drops it", () => {
  const { registry, latest } = setup();
  const ran: string[] = [];
  const below = {};
  const above = {};
  registry.bind(below, { id: "togglePanel", run: () => ran.push("below") });
  registry.bind(above, { id: "togglePanel", run: () => ran.push("above") });
  registry.dispatch("togglePanel");
  registry.unbind(above);
  registry.dispatch("togglePanel");
  registry.unbind(below);
  registry.dispatch("togglePanel");
  expect(ran).toEqual(["above", "below"]);
  expect(latest()).toEqual([]);
});

test("rebinding keeps a screen's place, so a retitle doesn't steal the command from a newer screen", () => {
  const { registry } = setup();
  const ran: string[] = [];
  const older = {};
  registry.bind(older, { id: "togglePanel", run: () => ran.push("older") });
  registry.bind({}, { id: "togglePanel", run: () => ran.push("newer") });
  registry.bind(older, { id: "togglePanel", run: () => ran.push("older"), title: "Hide panel" });
  registry.dispatch("togglePanel");
  expect(ran).toEqual(["newer"]);
});
