import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { flush, installTestDom, mount } from "@/test/dom";
import { restoreDefaultKeymap } from "../commands";
import { chordClaimCopy, type ChordClaim } from "./chord-claim";
import { KeybindingsPage } from "./keybindings-page";

installTestDom();

const CHORD = "Alt+Shift+Space";
const text = (node: unknown) => (node ? renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, "") : "");

afterEach(() => {
  delete (window as { telarDesktop?: unknown }).telarDesktop;
  restoreDefaultKeymap();
});

describe("what the Quick Composer row says about its chord", () => {
  test("a claimed chord needs no words", () => {
    expect(chordClaimCopy({ chord: CHORD, outcome: "claimed" }, CHORD)).toBeNull();
  });

  test("a chord held by the desktop portal says the desktop asks first", () => {
    const copy = chordClaimCopy({ chord: CHORD, outcome: "portal" }, CHORD);
    expect(text(copy?.hint)).toBe("Your desktop asks to allow this chord the first time, then keeps it in its own keyboard settings.");
    expect(text(copy?.info)).toContain("can change the keys");
  });

  test("a desktop that won't hand out chords names the command to bind instead", () => {
    const copy = chordClaimCopy({ chord: CHORD, outcome: "unavailable", reason: "desktop", command: "telar --quick-composer" }, CHORD);
    expect(text(copy?.hint)).toBe("This desktop doesn’t let apps claim chords, so bind one to telar --quick-composer in its keyboard settings.");
    expect(text(copy?.info)).toContain("starts the app first");
  });

  test("an AppImage is named by its own path", () => {
    const copy = chordClaimCopy({ chord: CHORD, outcome: "unavailable", reason: "desktop", command: '"/home/me/Telar.AppImage" --quick-composer' }, CHORD);
    expect(text(copy?.hint)).toContain("/home/me/Telar.AppImage");
  });

  test("a chord another app holds asks for another, and offers the command where there is one", () => {
    const linux = chordClaimCopy({ chord: CHORD, outcome: "unavailable", reason: "taken", command: "telar --quick-composer" }, CHORD);
    expect(text(linux?.hint)).toBe("Another app already holds this chord, so pick another.");
    expect(text(linux?.info)).toContain("telar --quick-composer");
    expect(chordClaimCopy({ chord: CHORD, outcome: "unavailable", reason: "taken" }, CHORD)?.info).toBeUndefined();
  });

  test("a report about a chord the row no longer shows is ignored", () => {
    expect(chordClaimCopy({ chord: "Control+Alt+K", outcome: "portal" }, CHORD)).toBeNull();
    expect(chordClaimCopy({ chord: CHORD, outcome: "portal" }, "")).toBeNull();
    expect(chordClaimCopy(null, CHORD)).toBeNull();
  });
});

describe("the Keybindings page", () => {
  const install = (first: ChordClaim | null) => {
    let push: (claim: ChordClaim | null) => void = () => {};
    (window as { telarDesktop?: unknown }).telarDesktop = {
      keybindings: {
        claim: async () => first,
        onClaim: (listener: (claim: ChordClaim | null) => void) => {
          push = listener;
          return () => {};
        },
      },
    };
    return (claim: ChordClaim | null) => act(async () => push(claim));
  };
  const row = (host: HTMLElement) => host.querySelector("#keybindings-quick-composer")?.textContent ?? "";

  test("shows what the desktop app reports, and follows it when it changes", async () => {
    const report = install({ chord: CHORD, outcome: "unavailable", reason: "desktop", command: "telar --quick-composer" });
    const { host } = await mount(<KeybindingsPage />);
    await flush(() => row(host).includes("doesn’t let apps"));
    expect(row(host)).toContain("bind one to telar --quick-composer");

    await report({ chord: CHORD, outcome: "claimed" });
    expect(row(host)).not.toContain("telar --quick-composer");
  });

  test("outside the desktop app the row says nothing extra", async () => {
    const { host } = await mount(<KeybindingsPage />);
    await flush();
    expect(row(host)).toContain("Quick composer");
    expect(row(host)).not.toContain("desktop");
  });
});
