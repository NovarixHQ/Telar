import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { artifactTheme, type ArtifactTheme } from "@telar/engine-client";
import { artifactDocument, contentHeight, frameHeight, hostContextMessage, latestArtifacts, measuredHeight, savedFileName } from "./artifacts";

const LOOK: Record<string, string> = { "--background": "oklch(0.975 0.002 286)", "--foreground": "oklch(0.274 0.006 286)", "--chart-1": "oklch(0.56 0.16 264)", "--app-font-sans": "ui-sans-serif" };
const look: ArtifactTheme = artifactTheme("dark", (token) => LOOK[token] ?? "");

test("the policy leads the document, ahead of an agent's own doctype and markup", () => {
  const doc = artifactDocument("<!DOCTYPE html><html><head><meta http-equiv='Content-Security-Policy' content='default-src *'></head></html>", "f1", look);
  expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
  expect(doc.match(/<!doctype/gi)).toHaveLength(1);
});

test("a frame id cannot close the reporting script", () => {
  expect(artifactDocument("<svg/>", "</script><script>alert(1)</script>", look)).not.toContain("</script><script>alert(1)");
});

test("a Look token cannot break out of the injected style", () => {
  expect(artifactDocument("<p>x</p>", "f1", { ...look, variables: { "--font-sans": "x}</style><script>alert(1)</script>" } })).not.toContain("</style><script>alert(1)");
});

test("the Look is in the head as hex before the page's first paint, and the page's own rules come after it", () => {
  const doc = artifactDocument("<style>:root{--background:pink}</style><p>x</p>", "f1", look);
  const sheet = /<style>(:where\(:root\)\{color-scheme:dark;[^<]*)<\/style>/.exec(doc)?.[1];
  expect(sheet).toMatch(/--background:#[0-9a-f]{6};/);
  expect(sheet).toMatch(/--chart-1:#[0-9a-f]{6};/);
  expect(sheet).toContain("--font-sans:ui-sans-serif;");
  expect(sheet).not.toContain("oklch");
  expect(doc.indexOf(sheet!)).toBeLessThan(doc.indexOf(":root{--background:pink}"));
});

function runFrame(doc: string) {
  GlobalRegistrator.register({ url: "http://localhost/", settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } as never });
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
  document.write(doc);
  return document;
}

test("a Look change posted into the frame restyles it in place, and only its parent may post one", () => {
  const frame = runFrame(artifactDocument("<p id='kept'>x</p>", "f1", look));
  const kept = frame.getElementById("kept");
  const next = artifactTheme("light", (token) => ({ "--background": "#000000" })[token] ?? "");
  window.dispatchEvent(new MessageEvent("message", { data: hostContextMessage(next), source: {} as Window }));
  const sheet = frame.querySelector("style")!;
  expect(sheet.textContent).toContain("color-scheme:dark");
  window.dispatchEvent(new MessageEvent("message", { data: hostContextMessage(next), source: window.parent }));
  expect(sheet.textContent).toBe(":where(:root){color-scheme:light;--background:#000000;}");
  expect(frame.querySelectorAll("script")).toHaveLength(0);
  expect(frame.getElementById("kept")).toBe(kept);
});

test("a reported height is rounded up and bounded, and anything that is not a number is ignored", () => {
  expect(measuredHeight(10)).toBe(48);
  expect(measuredHeight(99_999)).toBe(2000);
  expect(measuredHeight(300.2)).toBe(301);
  expect(measuredHeight("300")).toBeUndefined();
  expect(measuredHeight(Number.NaN)).toBeUndefined();
});

test("the frame holds the agent's height until the page measures itself, and that height caps it", () => {
  expect(frameHeight(undefined, undefined)).toBe(160);
  expect(frameHeight(420, undefined)).toBe(420);
  expect(frameHeight(420, 300)).toBe(300);
  expect(frameHeight(420, 900)).toBe(420);
  expect(frameHeight(undefined, 900)).toBe(900);
});

test("a saved artifact is named after its title, with the extension of its kind", () => {
  expect(savedFileName({ title: "Q3: revenue/cost?", kind: "html" })).toBe("Q3 revenue cost.html");
  expect(savedFileName({ title: "  ", kind: "mermaid" })).toBe("Artifact.mmd");
});

test("the newest version of each artifact wins, in any order", () => {
  const item = (id: string, version: number) => ({ detail: { type: "artifact" as const, artifact: { id, kind: "svg" as const, title: "t", attachmentId: `att_${id}${version}`, version } } });
  const latest = latestArtifacts([item("a", 2), item("a", 1), item("b", 1), { detail: { type: "assistant_message" as const, text: "" } }]);
  expect([...latest].map(([id, artifact]) => `${id}:${artifact.version}`)).toEqual(["a:2", "b:1"]);
});

afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function frameWithContentEndingAt(bottom: number) {
  GlobalRegistrator.register({ url: "http://localhost/" });
  document.body.innerHTML = '<div class="kpis">18</div><div id="last" style="margin-bottom: 8px">last row</div><details id="data"><summary>Data</summary><table></table></details><script style="margin-bottom: 99px"></script>';
  document.body.style.padding = "20px";
  const at = (id: string, edge: number, visible = true) => {
    const element = document.getElementById(id)!;
    element.getBoundingClientRect = () => new DOMRect(0, 0, 600, edge);
    element.checkVisibility = () => visible;
  };
  at("last", bottom);
  at("data", bottom + 900, false);
  return document;
}

test("the measured height is where the visible content ends, plus the body's own padding and the last margin", () => {
  expect(contentHeight(frameWithContentEndingAt(300))).toBe(328);
});

test("content the page hides, like a closed details table, does not stretch the frame", () => {
  const doc = frameWithContentEndingAt(300);
  expect(contentHeight(doc)).toBeLessThan(400);
});

test("re-measuring after the frame grows gives the same height, even for a body that fills the viewport", () => {
  const doc = frameWithContentEndingAt(300);
  const first = contentHeight(doc);
  doc.body.style.minHeight = "100vh";
  doc.body.style.height = `${first + 400}px`;
  expect(contentHeight(doc)).toBe(first);
});
