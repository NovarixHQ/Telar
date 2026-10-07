import { describe, expect, mock, test } from "bun:test";
import type { Artifact, ArtifactKind, Item } from "@telar/engine-client";
import { buttonLabelled, click as clickOn, flush, installTestDom, mount, stubBoxSize } from "@/test/dom";
import "@/features/panel";
import { act } from "react";
import { ArtifactCard, ArtifactShelf } from "./artifact-card";

installTestDom();
stubBoxSize(600, 400);

const drawn: Array<{ source: string; theme: unknown; themeVariables: Record<string, unknown> | undefined }> = [];
void mock.module("@streamdown/mermaid", () => ({
  mermaid: {
    getMermaid: (config?: { theme?: string; themeVariables?: Record<string, unknown> }) => ({
      render: async (_id: string, source: string) => {
        drawn.push({ source, theme: config?.theme, themeVariables: config?.themeVariables });
        return { svg: '<svg id="drawn-diagram"><text>A to B</text></svg>' };
      },
    }),
  },
}));

const SOURCES: Record<string, string> = {
  att_html: "<h1>Revenue</h1><script>document.title='x'</script>",
  att_sized: "<h1>Sized</h1>",
  att_unsized: "<h1>Unsized</h1>",
  att_remembered: "<h1>Remembered</h1>",
  att_reflows: "<p>Reflows</p>",
  att_svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle id="agent-dot" r="4"/></svg>',
  att_md: "# Plan\n\n- ship it",
  att_mermaid: "graph TD; A-->B",
};

function serveAttachments() {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    asked.push(path);
    if (path.endsWith("/att_pending")) return new Promise<Response>(() => {});
    const source = SOURCES[path.split("/").at(-1)!];
    return source === undefined ? new Response("missing", { status: 404 }) : new Response(source, { headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
  return asked;
}

const artifact = (kind: ArtifactKind, attachmentId: string, version = 1, height?: number): Artifact => ({ id: "art_1", kind, title: `A ${kind}`, attachmentId, version, ...(height ? { height } : {}) });
const item = (value: Artifact): Pick<Item, "detail"> => ({ detail: { type: "artifact", artifact: value } });

async function card(value: Artifact, items: Pick<Item, "detail">[] = [item(value)]) {
  const { host } = await mount(
    <ArtifactShelf items={items}>
      <ArtifactCard sessionId="session_1" artifact={value} />
    </ArtifactShelf>,
  );
  return host;
}

describe("an artifact card", () => {
  test("html runs in a frame that may script but never shares the cockpit's origin or network", async () => {
    const asked = serveAttachments();
    const host = await card(artifact("html", "att_html"));
    await flush(() => host.querySelector("iframe") !== null);
    const frame = host.querySelector("iframe")!;
    expect(asked).toEqual(["/api/sessions/session_1/attachments/att_html"]);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("default-src 'none'");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<h1>Revenue</h1>"));
  });

  const reporter = (frame: HTMLIFrameElement) => {
    const id = JSON.parse(/artifactFrame:("[^"]*")/.exec(frame.getAttribute("srcdoc")!)![1]!) as string;
    return async (height: number) => {
      await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { artifactFrame: id, height }, source: frame.contentWindow })));
    };
  };

  test("the agent's height is held before the page arrives, so nothing below it moves", async () => {
    serveAttachments();
    const host = await card(artifact("html", "att_pending", 1, 420));
    await flush(() => host.querySelector("figure > div") !== null);
    expect((host.querySelector("figure > div") as HTMLElement).style.height).toBe("420px");
  });

  test("an html frame fits the height its page reports, capped by the agent's height", async () => {
    serveAttachments();
    const host = await card(artifact("html", "att_sized", 1, 420));
    await flush(() => host.querySelector("iframe") !== null);
    const frame = host.querySelector("iframe")!;
    expect(frame.style.height).toBe("420px");
    const report = reporter(frame);
    await report(312.4);
    expect(frame.style.height).toBe("313px");
    await report(4000);
    expect(frame.style.height).toBe("420px");
  });

  test("without a height from the agent, a long page grows the frame to the limit", async () => {
    serveAttachments();
    const host = await card(artifact("html", "att_unsized"));
    await flush(() => host.querySelector("iframe") !== null);
    const frame = host.querySelector("iframe")!;
    await reporter(frame)(4000);
    expect(frame.style.height).toBe("2000px");
  });

  test("a frame drawn again opens at the height its page last reported", async () => {
    serveAttachments();
    const first = await card(artifact("html", "att_remembered"));
    await flush(() => first.querySelector("iframe") !== null);
    await reporter(first.querySelector("iframe")!)(256);
    const again = await card(artifact("html", "att_remembered"));
    await flush(() => again.querySelector("iframe") !== null);
    expect(again.querySelector("iframe")!.style.height).toBe("256px");
  });

  test("a height remembered at one chat width is not reserved at another, where the page reflows", async () => {
    serveAttachments();
    const first = await card(artifact("html", "att_reflows", 1, 600));
    await flush(() => first.querySelector("iframe") !== null);
    await reporter(first.querySelector("iframe")!)(256);
    localStorage.setItem("telar-appearance", JSON.stringify({ chatWidth: "wide" }));
    try {
      const wide = await card(artifact("html", "att_reflows", 1, 600));
      await flush(() => wide.querySelector("iframe") !== null);
      const frame = wide.querySelector("iframe")!;
      expect(frame.style.height).toBe("600px");
      await reporter(frame)(180);
      expect(frame.style.height).toBe("180px");
    } finally {
      localStorage.removeItem("telar-appearance");
    }
    const comfortable = await card(artifact("html", "att_reflows", 1, 600));
    await flush(() => comfortable.querySelector("iframe") !== null);
    expect(comfortable.querySelector("iframe")!.style.height).toBe("256px");
  });

  test("an html frame wears the Look in hex, with --background as the canvas painted around it", async () => {
    serveAttachments();
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.setProperty("--background", "oklch(0 0 0)");
    root.style.setProperty("--primary", "rgb(9, 8, 7)");
    document.body.style.backgroundColor = "rgb(20, 20, 20)";
    try {
      const host = await card(artifact("html", "att_html"));
      await flush(() => host.querySelector("iframe") !== null);
      const frame = host.querySelector("iframe")!;
      const doc = frame.getAttribute("srcdoc")!;
      expect(frame.style.colorScheme).toBe("dark");
      expect(doc).toContain("color-scheme:dark");
      expect(doc).toContain("--background:#141414;");
      expect(doc).toContain("--primary:#090807;");
    } finally {
      document.body.style.removeProperty("background-color");
      await act(async () => {
        root.classList.remove("dark");
        root.style.removeProperty("--background");
        root.style.removeProperty("--primary");
      });
    }
  });

  test("on a see-through Look the frame's --background is transparent, so the page shows the same glass as the reply", async () => {
    serveAttachments();
    document.body.style.backgroundColor = "rgba(10, 10, 10, 0.55)";
    try {
      const host = await card(artifact("html", "att_html"));
      await flush(() => host.querySelector("iframe") !== null);
      expect(host.querySelector("iframe")!.getAttribute("srcdoc")).toContain("--background:transparent;");
    } finally {
      document.body.style.removeProperty("background-color");
    }
  });

  test("a Look change is posted into the open frame, which keeps its page instead of reloading", async () => {
    serveAttachments();
    const root = document.documentElement;
    const host = await card(artifact("html", "att_html"));
    await flush(() => host.querySelector("iframe") !== null);
    const frame = host.querySelector("iframe")!;
    const before = frame.getAttribute("srcdoc");
    const posted: unknown[] = [];
    frame.contentWindow!.postMessage = ((message: unknown) => posted.push(message)) as Window["postMessage"];
    try {
      await act(async () => {
        root.classList.add("dark");
        root.style.setProperty("--chart-1", "oklch(1 0 0)");
      });
      await flush(() => posted.length > 0);
      expect(posted.at(-1)).toMatchObject({ method: "ui/notifications/host-context-changed", params: { theme: "dark", styles: { variables: { "--chart-1": "#ffffff" } } } });
      expect(frame.getAttribute("srcdoc")).toBe(before);
      expect(frame.style.colorScheme).toBe("dark");
    } finally {
      await act(async () => {
        root.classList.remove("dark");
        root.style.removeProperty("--chart-1");
      });
    }
  });

  test("svg is drawn as an image, so none of its markup reaches the page", async () => {
    serveAttachments();
    const host = await card(artifact("svg", "att_svg"));
    await flush(() => host.querySelector("[role=img]") !== null);
    const drawn = decodeURIComponent((host.querySelector("[role=img]") as HTMLElement).style.backgroundImage);
    expect(drawn).toStartWith('url("data:image/svg+xml');
    expect(drawn).toContain('id="agent-dot"');
    expect(host.querySelector("#agent-dot")).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
  });

  test("an svg sits straight on the reply's canvas, with no box or ground of its own", async () => {
    serveAttachments();
    const host = await card(artifact("svg", "att_svg"));
    await flush(() => host.querySelector("[role=img]") !== null);
    expect((host.querySelector("[role=group]") as HTMLElement).style.background).toBe("");
  });

  test("markdown renders as the transcript renders it", async () => {
    serveAttachments();
    const host = await card(artifact("markdown", "att_md"));
    await flush(() => host.querySelector("h1") !== null);
    expect(host.querySelector("h1")?.textContent).toBe("Plan");
    expect(host.textContent).toContain("ship it");
  });

  test("mermaid is drawn to an svg image in a pan-and-zoom viewer, with no code-block chrome", async () => {
    serveAttachments();
    drawn.length = 0;
    const host = await card(artifact("mermaid", "att_mermaid"));
    await flush(() => host.querySelector("[role=img]") !== null);
    expect(drawn).toMatchObject([{ source: "graph TD; A-->B", theme: "base", themeVariables: { darkMode: false } }]);
    expect(decodeURIComponent((host.querySelector("[role=img]") as HTMLElement).style.backgroundImage)).toContain('id="drawn-diagram"');
    expect(buttonLabelled("Fit", host)).toBeDefined();
    expect(host.querySelector("pre, code, [data-streamdown], #drawn-diagram")).toBeNull();
  });

  test("mermaid takes the Look's own colours, and is drawn again when the Look changes", async () => {
    serveAttachments();
    drawn.length = 0;
    const root = document.documentElement;
    root.style.setProperty("--card", "oklch(1 0 0)");
    root.style.setProperty("--primary", "rgb(51, 102, 255)");
    try {
      const host = await card(artifact("mermaid", "att_mermaid"));
      await flush(() => host.querySelector("[role=img]") !== null);
      expect(drawn.at(-1)?.themeVariables).toMatchObject({ darkMode: false, primaryColor: "#ffffff", primaryBorderColor: "#3366ff" });
      await act(async () => root.style.setProperty("--primary", "rgb(255, 0, 0)"));
      await flush(() => drawn.length > 1);
      expect(drawn.at(-1)?.themeVariables).toMatchObject({ primaryBorderColor: "#ff0000" });
    } finally {
      await act(async () => {
        root.style.removeProperty("--card");
        root.style.removeProperty("--primary");
      });
    }
  });

  test("an earlier version folds to a quiet line, and only the newest is drawn", async () => {
    serveAttachments();
    const first = artifact("markdown", "att_md", 1);
    const host = await card(first, [item(first), item(artifact("markdown", "att_md", 2))]);
    await flush();
    expect(host.textContent).toBe("A markdown · updated below");
    expect(host.querySelector("h1")).toBeNull();
  });

  test("inline there is no header, title or panel button: the page is part of the reply", async () => {
    serveAttachments();
    const host = await card(artifact("html", "att_html"));
    await flush(() => host.querySelector("iframe") !== null);
    expect(host.querySelector("figure")?.getAttribute("aria-label")).toBe("A html");
    expect(host.querySelector("figcaption")).toBeNull();
    expect(host.textContent).not.toContain("A html");
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Copy source", "Save"]);
  });

  test("the hover controls copy the source and save it under the artifact's title", async () => {
    serveAttachments();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    const saved: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download);
    };
    try {
      const host = await card(artifact("markdown", "att_md"));
      await flush(() => host.querySelector("h1") !== null);
      await clickOn(buttonLabelled("Copy source", host));
      expect(copied).toEqual(["# Plan\n\n- ship it"]);
      expect(buttonLabelled("Copied", host)).toBeDefined();
      await clickOn(buttonLabelled("Save", host));
      expect(saved).toEqual(["A markdown.md"]);
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
  });
});
