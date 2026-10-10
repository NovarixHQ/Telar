import { expect, test } from "bun:test";
import { editorHistory } from "./editor-history";

test("a burst of keystrokes undoes as one step, and redo brings it back", () => {
  const history = editorHistory();
  history.reset("");
  history.record("a", 1, true, 0);
  history.record("ab", 2, true, 300);
  history.record("ab ", 3, true, 3000);
  expect(history.undo()).toEqual({ text: "ab", caret: 2 });
  expect(history.undo()).toEqual({ text: "", caret: 0 });
  expect(history.undo()).toBeUndefined();
  expect(history.redo()).toEqual({ text: "ab", caret: 2 });
});

test("an edit that is not typing is its own step, and a new edit drops the redo", () => {
  const history = editorHistory();
  history.reset("x");
  history.record("xy", 2, true, 0);
  history.record("xy\n- ", 5, false, 100);
  expect(history.undo()).toEqual({ text: "xy", caret: 2 });
  history.record("xyz", 3, true, 200);
  expect(history.redo()).toBeUndefined();
  expect(history.undo()).toEqual({ text: "xy", caret: 2 });
});
