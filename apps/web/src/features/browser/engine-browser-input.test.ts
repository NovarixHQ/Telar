import { expect, test } from "bun:test";
import { addressToUrl, keyInput, mouseInput, pagePoint } from "./engine-browser-input";

const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

test("a pointer on a scaled frame lands on the matching point of the page", () => {
  const drawn = { left: 100, top: 50, width: 640, height: 400 };
  expect(pagePoint({ clientX: 420, clientY: 250 }, drawn, { width: 1280, height: 800 })).toEqual({ x: 640, y: 400 });
});

test("mouse input names the button, clamps the click count and folds the modifier keys", () => {
  expect(mouseInput("down", { ...none, shiftKey: true, ctrlKey: true, button: 2, detail: 5 }, { x: 1, y: 2 })).toEqual({ type: "mouse", action: "down", x: 1, y: 2, button: "right", clickCount: 3, modifiers: 10 });
  expect(mouseInput("move", { ...none, button: 0, detail: 0 }, { x: 0, y: 0 })).toMatchObject({ button: "left", clickCount: 1, modifiers: 0 });
});

test("a printable key types its character, Enter and Tab type theirs, and a shortcut types nothing", () => {
  expect(keyInput("down", { ...none, key: "a", code: "KeyA", keyCode: 65 })).toMatchObject({ key: "a", text: "a" });
  expect(keyInput("down", { ...none, key: "Enter", code: "Enter", keyCode: 13 })).toMatchObject({ text: "\r" });
  expect(keyInput("down", { ...none, key: "Tab", code: "Tab", keyCode: 9 })).toMatchObject({ text: "\t" });
  expect(keyInput("down", { ...none, ctrlKey: true, key: "c", code: "KeyC", keyCode: 67 })).not.toHaveProperty("text");
  expect(keyInput("up", { ...none, key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 })).not.toHaveProperty("text");
});

test("an address becomes an http(s) page or nothing", () => {
  expect(addressToUrl("example.com/a")).toBe("https://example.com/a");
  expect(addressToUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  expect(addressToUrl("  ")).toBeNull();
  expect(addressToUrl("two words")).toBeNull();
  expect(addressToUrl("javascript://x")).toBeNull();
  expect(addressToUrl("file:///etc/passwd")).toBeNull();
});
