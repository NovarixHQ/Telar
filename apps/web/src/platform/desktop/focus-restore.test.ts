import { afterEach, describe, expect, test } from "bun:test";
import { installTestDom } from "@/test/dom";
import { installFocusRestore } from "./focus-restore";

installTestDom();

afterEach(() => Reflect.deleteProperty(window, "telarDesktop"));

describe("handing focus back from the shell", () => {
  test("re-focuses the element that had it, so the caret is real again", () => {
    let restore = () => {};
    (window as unknown as { telarDesktop: unknown }).telarDesktop = { windowFocus: { onRestore: (listener: () => void) => ((restore = listener), () => {}) } };
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    const seen: string[] = [];
    field.addEventListener("blur", () => seen.push("blur"));
    field.addEventListener("focus", () => seen.push("focus"));
    const off = installFocusRestore();
    restore();
    expect(seen).toEqual(["blur", "focus"]);
    expect(document.activeElement).toBe(field);
    off();
    field.remove();
  });

  test("outside the desktop shell it does nothing", () => {
    expect(() => installFocusRestore()()).not.toThrow();
  });
});
