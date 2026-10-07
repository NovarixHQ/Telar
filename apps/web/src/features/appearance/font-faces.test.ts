import { expect, test } from "bun:test";
import { installTestDom } from "@/test/dom";
import { fontFaceCss } from "./font-faces";

installTestDom();

const FONT = "d09GMg==";

function serveFonts(): string[] {
  const fetched: string[] = [];
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url));
    return new Response(new Blob([Uint8Array.from(atob(FONT), (c) => c.charCodeAt(0))], { type: "font/woff2" }));
  }) as typeof fetch;
  return fetched;
}

test("inlines the Latin faces of the families that open the stacks, fetching each file once", async () => {
  const sheet = document.createElement("style");
  sheet.textContent = [
    "@font-face{font-family:'Geist';font-style:normal;src:url(/_next/static/media/geist-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131}",
    "@font-face{font-family:'Geist';font-style:normal;src:url(/_next/static/media/geist-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F}",
    "@font-face{font-family:'Geist Mono';src:url(/_next/static/media/mono.woff2) format('woff2')}",
    "@font-face{font-family:'Inter';src:url(/_next/static/media/inter.woff2) format('woff2')}",
  ].join("");
  document.head.append(sheet);
  const fetched = serveFonts();

  const css = await fontFaceCss(['"Geist", "Geist Fallback", ui-sans-serif', "'Geist Mono', ui-monospace"]);
  expect(fetched).toEqual(["http://localhost/_next/static/media/geist-latin.woff2", "http://localhost/_next/static/media/mono.woff2"]);
  expect(css).toBe(
    `@font-face{font-family:"Geist";src:url(data:font/woff2;base64,${FONT});font-style:normal;unicode-range:U+0000-00FF, U+0131}` +
      `@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${FONT})}`,
  );

  expect(await fontFaceCss(['"Geist", sans-serif', '"Geist Mono"'])).toBe(css);
  expect(fetched).toHaveLength(2);
  sheet.remove();
});

test("a stack that opens with a system family or a face the cockpit never loaded inlines nothing", async () => {
  const fetched = serveFonts();
  expect(await fontFaceCss(["ui-sans-serif, system-ui", '"Comic Sans MS", sans-serif'])).toBe("");
  expect(fetched).toEqual([]);
});
