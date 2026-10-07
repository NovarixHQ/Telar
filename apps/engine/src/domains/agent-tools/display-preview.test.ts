import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_ARTIFACT_BYTES, parsePublishedAppearance, type PublishedAppearance } from "@telar/engine-client";
import type { PreviewRendering, PreviewRequest } from "./display-preview";
import { createDisplayCapability, displayTools } from "./display-tools";

type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };

const rendering: PreviewRendering = {
  png: "iVBORw0KGgo=",
  contentHeight: 412,
  capturedHeight: 412,
  console: [{ level: "error", text: "Uncaught ReferenceError: chart is not defined", stack: "at draw (about:blank:3:7)" }],
  failedLoads: [{ url: "https://cdn.example.com/chart.js", reason: "blocked by the artifact's content security policy" }],
};

function preview(options: { render?: (request: PreviewRequest) => Promise<PreviewRendering>; desktop?: boolean; timeoutMs?: number; cwd?: string; look?: PublishedAppearance | null } = {}) {
  const requests: PreviewRequest[] = [];
  const capability = createDisplayCapability({
    cwd: options.cwd ?? os.tmpdir(),
    report: async () => undefined,
    upload: async () => ({ id: "att_1" }),
    ...(options.desktop === false
      ? {}
      : {
          renderer: {
            render: async (request) => {
              requests.push(request);
              return (options.render ?? (async () => rendering))(request);
            },
          },
        }),
    ...(options.timeoutMs ? { previewTimeoutMs: options.timeoutMs } : {}),
    ...(options.look !== undefined ? { look: async () => options.look ?? null } : {}),
  });
  let run: ((args: Record<string, unknown>) => Promise<Result>) | undefined;
  displayTools((name, _description, _shape, handler) => {
    if (name === "display_preview") run = handler as never;
    return { name };
  }, capability);
  return { run: run!, requests, capability };
}

const FACES = '@font-face{font-family:"Inter";src:url(data:font/woff2;base64,d09GMg==)}';

const textOf = (result: Result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

describe("display_preview", () => {
  test("answers with the screenshot, the height, the console with stacks and the failed loads", async () => {
    const { run, requests } = preview();
    const result = await run({ kind: "html", content: "<!doctype html><p>hi</p>" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "image", data: rendering.png, mimeType: "image/png" });
    const text = textOf(result);
    expect(text).toContain("728 px wide in light");
    expect(text).toContain("412 px tall");
    expect(text).toContain("error: Uncaught ReferenceError: chart is not defined");
    expect(text).toContain("    at draw (about:blank:3:7)");
    expect(text).toContain("https://cdn.example.com/chart.js");
    expect(text).toContain("call display_inline");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ width: 728, appearance: "light" });
  });

  test("renders the page in Telar's own Look for the asked appearance, open to the network", async () => {
    const { run, requests } = preview();
    await run({ kind: "html", content: "<!DOCTYPE html><p>hi</p>", width: 400, appearance: "dark" });
    const { html, width, appearance } = requests[0]!;
    expect({ width, appearance }).toEqual({ width: 400, appearance: "dark" });
    expect(html).toStartWith('<!doctype html><html data-scheme="dark">');
    expect(html).toContain("color-scheme:dark;--scheme:dark;");
    expect(html).toContain("--background:#0a0a0a;");
    expect(html).toContain("--chart-1:");
    expect(html).toMatch(/--input:#[0-9a-f]{6};--ring:#[0-9a-f]{6};/);
    expect(html).toMatch(/--shadow-2:0 1px 2px -1px color-mix\(in oklab, color-mix\(in oklab, #0a0a0a 45%, #000\) 33%, transparent\), 0 4px 12px -7px /);
    expect(html).not.toContain("oklch");
    expect(html).not.toContain("Content-Security-Policy");
    expect(html.match(/<!doctype/gi)).toHaveLength(1);
    expect(html.endsWith("<p>hi</p>")).toBe(true);
  });

  test("wears the person's published Look, its font faces and its scheme when no appearance is asked for", async () => {
    const look = parsePublishedAppearance({
      scheme: "dark",
      translucent: false,
      frost: "clear",
      resolved: { accent: { name: "rose", light: { primary: "#cc0044", primaryForeground: "#ffffff" }, dark: { primary: "#ff5588", primaryForeground: "#110000" } }, fontStacks: { sans: "Inter, sans-serif", mono: "Menlo, monospace" }, fontFaces: FACES },
      look: { version: 2, id: "mine", label: "Mine", composition: { light: { base: "#f8f8f9", layers: [], overrides: {} }, dark: { base: "#252525", layers: [], overrides: { card: "#123456" } } } },
    })!;
    const { run, requests } = preview({ look });
    const result = await run({ kind: "html", content: "<p>hi</p>" });
    expect(textOf(result)).toContain("in dark");
    const { html, appearance } = requests[0]!;
    expect(appearance).toBe("dark");
    for (const token of ["--card:#123456;", "--primary:#ff5588;", "--primary-foreground:#110000;", "--font-sans:Inter, sans-serif;", "--font-mono:Menlo, monospace;"]) expect(html).toContain(token);
    expect(html.indexOf(FACES)).toBeLessThan(html.indexOf("<p>hi</p>"));
  });

  test("a Look the engine cannot read leaves Telar's own, in light", async () => {
    const { run, requests } = preview({ look: null });
    await run({ kind: "html", content: "<p>hi</p>" });
    expect(requests[0]!.appearance).toBe("light");
    expect(requests[0]!.html).toContain("color-scheme:light");
  });

  test("mermaid is drawn by mermaid in the Look's colours, and a failure lands in the console", async () => {
    const { run, requests } = preview();
    await run({ kind: "mermaid", content: "graph TD; A-->B</script>", appearance: "light" });
    const { html } = requests[0]!;
    expect(html).toContain("cdn.jsdelivr.net/npm/mermaid@11");
    expect(html).toContain('"theme":"base"');
    expect(html).toContain('"primaryColor":"#ffffff"');
    expect(html).toContain("graph TD; A-->B\\u003c/script>");
    expect(html).toContain("This diagram could not be drawn");
  });

  test("an svg is drawn as an image, as the conversation draws it, so its scripts never run", async () => {
    const { run, requests } = preview();
    await run({ kind: "svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>' });
    expect(requests[0]!.html).toContain('<img alt="" style="display:block;max-width:100%" src="data:image/svg+xml;charset=utf-8,%3Csvg');
    expect(requests[0]!.html).not.toContain("<script>x()");
  });

  test("tells the agent the screenshot is cut short when the page is taller than the capture", async () => {
    const { run } = preview({ render: async () => ({ ...rendering, contentHeight: 9000, capturedHeight: 4000 }) });
    expect(textOf(await run({ kind: "html", content: "<p>tall</p>" }))).toContain("9000 px tall; the screenshot shows the first 4000 px");
  });

  test("refuses a bad kind, width, appearance or source before rendering anything", async () => {
    const { run, requests } = preview();
    expect(textOf(await run({ kind: "markdown", content: "# hi" }))).toContain("html, svg, mermaid");
    expect(textOf(await run({ kind: "html", content: "x", width: 100 }))).toContain("240 to 1600");
    expect(textOf(await run({ kind: "html", content: "x", width: 400.5 }))).toContain("240 to 1600");
    expect(textOf(await run({ kind: "html", content: "x", appearance: "sepia" }))).toContain("light or dark");
    expect((await run({ kind: "html" })).isError).toBe(true);
    expect((await run({ kind: "html", content: "x", path: "a.html" })).isError).toBe(true);
    expect(requests).toEqual([]);
  });

  test("refuses a source over the artifact limit, so a preview never passes what publishing would refuse", async () => {
    const { run, requests } = preview();
    const result = await run({ kind: "html", content: "x".repeat(MAX_ARTIFACT_BYTES + 1) });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("limit is 512 KB");
    expect(requests).toEqual([]);
  });

  test("reads a source the agent left in the temp folder, so nothing is staged in the project", async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "telar-scratch-"));
    const cwd = fs.mkdtempSync(path.join(os.homedir(), ".telar-preview-checkout-"));
    try {
      fs.writeFileSync(path.join(scratch, "chart.html"), "<h1>From tmp</h1>");
      const { run, requests } = preview({ cwd });
      await run({ kind: "html", path: path.join(scratch, "chart.html") });
      expect(requests[0]!.html).toContain("<h1>From tmp</h1>");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("reads the source from a checkout file", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "telar-preview-"));
    try {
      fs.writeFileSync(path.join(cwd, "page.html"), "<h1>From disk</h1>");
      const { run, requests } = preview({ cwd });
      await run({ kind: "html", path: "page.html" });
      expect(requests[0]!.html).toContain("<h1>From disk</h1>");
      expect(textOf(await run({ kind: "html", path: "/etc/hosts" }))).toContain("outside this session's checkout and the temp folder");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("without the desktop app it says so plainly, and the capability has no preview", async () => {
    const { run, capability } = preview({ desktop: false });
    const result = await run({ kind: "html", content: "<p>hi</p>" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Preview needs the Telar desktop app");
    expect(capability.preview).toBeUndefined();
  });

  test("gives up when the renderer never answers, and hands the desktop a shorter deadline", async () => {
    const { run, requests } = preview({ render: () => new Promise(() => undefined), timeoutMs: 2_050 });
    const result = await run({ kind: "html", content: "<script>for(;;){}</script>" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("took longer than 3 s");
    expect(requests[0]!.timeoutMs).toBe(50);
  });

  test("a renderer failure comes back as a sentence", async () => {
    const { run } = preview({
      render: async () => {
        throw new Error("the desktop app did not answer");
      },
    });
    const result = await run({ kind: "html", content: "<p>hi</p>" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Could not preview it: the desktop app did not answer. Publish it with display_inline anyway; don't retry the preview.");
  });
});
