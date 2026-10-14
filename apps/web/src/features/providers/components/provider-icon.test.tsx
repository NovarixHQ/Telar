/**
 * THE SMALL BRAND MARKS, DRAWN AT THE SIZE THEY WERE ASKED FOR — issue #398.
 *
 * The bug this pins is not cosmetic taste, it is a cascade fact: `width` and
 * `height` on an `<svg>` are PRESENTATION ATTRIBUTES, and every button and menu
 * row in this app carries `[&_svg:not([class*='size-'])]:size-4`, which is a
 * class and therefore wins. A `<ProviderIcon size={11} />` in a session row was
 * being drawn at 16px — not only the wrong size, but a 24-unit path landing on
 * edges the device grid has no pixel for. An inline style is the one thing that
 * class cannot override.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectionIcon, connectionMark, CURSOR_MARK, OPENCODE_MARK } from "./connection-icon";
import { driverLabel, ModelPillIcon, ModelRowIcon, modelVendorLabel, ProviderIcon } from "./provider-icon";

const SIZES = [11, 13, 14, 16, 20];

describe("a provider mark", () => {
  for (const provider of ["claude", "codex", "opencode", "cursor"] as const) {
    test(`${provider} honours every size it is given, in a style a container cannot override`, () => {
      for (const size of SIZES) {
        const markup = renderToStaticMarkup(<ProviderIcon provider={provider} size={size} />);
        expect(markup).toContain(`width:${size}px`);
        expect(markup).toContain(`height:${size}px`);
        expect(markup).toContain(`width="${size}"`);
      }
    });

    test(`${provider} keeps its curves rather than snapping them to the grid`, () => {
      expect(renderToStaticMarkup(<ProviderIcon provider={provider} size={13} />)).toContain('shape-rendering="geometricPrecision"');
    });
  }

  test("Cursor wears its own mark, cut out rather than filled in", () => {
    const markup = renderToStaticMarkup(<ProviderIcon provider="cursor" size={13} />);
    expect(markup).toContain(CURSOR_MARK.d);
    expect(markup).toContain('fill-rule="evenodd"');
    expect(markup).toContain("text-foreground/80");
    expect(driverLabel("cursor")).toBe("Cursor");
  });

  test("a driver Telar has no mark for still gets a glyph, never a borrowed logo", () => {
    const markup = renderToStaticMarkup(<ProviderIcon provider="some-acp-agent" size={13} />);
    expect(markup).toContain("width:13px");
    expect(markup).not.toContain(CURSOR_MARK.d);
    expect(markup).not.toContain(OPENCODE_MARK.d);
  });

  test("Claude keeps its brand colour; the other two take the surface's", () => {
    expect(renderToStaticMarkup(<ProviderIcon provider="claude" />)).toContain("text-[#d97757]");
    expect(renderToStaticMarkup(<ProviderIcon provider="codex" />)).toContain("text-foreground/80");
  });
});

describe("a connection mark", () => {
  test("a known connection is sized by style and drawn precisely", () => {
    const markup = renderToStaticMarkup(<ConnectionIcon connection="openai" size={13} />);
    expect(markup).toContain("width:13px");
    expect(markup).toContain('shape-rendering="geometricPrecision"');
  });

  test("an unknown one is still a neutral monogram, never a borrowed logo", () => {
    const markup = renderToStaticMarkup(<ConnectionIcon connection="zz-unknown" size={14} />);
    expect(markup).not.toContain("<path");
    expect(markup).toContain("zz");
  });

  test("a model row inherits the same sizing through whichever mark it resolves to", () => {
    const markup = renderToStaticMarkup(<ModelRowIcon driver="claude" modelId="sonnet" size={16} />);
    expect(markup).toContain("width:16px");
  });
});

/**
 * A PROVIDER'S MARK AND AN ACCOUNT'S MARK ARE DIFFERENT THINGS — issue #655.
 *
 * models.dev's `opencode` entry is OPENCODE ZEN, one account type under the
 * OpenCode provider: a blocky Z, beside `opencode-go`'s blocky G. Telar drew
 * that Z for the provider itself, so every OpenCode row — Bedrock-routed,
 * Copilot-routed — answered "who serves this?" with "Zen". The fix is the
 * distinction; the asset is a consequence of it.
 */
describe("OpenCode's provider mark is not Zen's account mark", () => {
  test("the provider draws OpenCode's own mark, and the Zen connection keeps the Z", () => {
    const zen = connectionMark("opencode")!;
    expect(zen.d).not.toBe(OPENCODE_MARK.d);

    const provider = renderToStaticMarkup(<ProviderIcon provider="opencode" />);
    expect(provider).toContain(OPENCODE_MARK.d);
    expect(provider).not.toContain(zen.d);

    // And Zen, ASKED FOR BY NAME, still gets its own mark — this was never a
    // wrong asset, only a wrongly borrowed one.
    expect(renderToStaticMarkup(<ConnectionIcon connection="opencode" />)).toContain(zen.d);
  });

  test("a Bedrock-routed OpenCode row wears Bedrock's mark, not Zen's and not OpenCode's", () => {
    const markup = renderToStaticMarkup(<ModelRowIcon driver="opencode" modelId="amazon-bedrock/anthropic.claude-fable-5" />);
    expect(markup).toContain(connectionMark("amazon-bedrock")!.d);
    expect(markup).not.toContain(connectionMark("opencode")!.d);
    expect(markup).not.toContain(OPENCODE_MARK.d);
  });

  test("OpenCode Go wears its own G rather than borrowing Zen's Z", () => {
    // `opencode-go` used to be ALIASED to `opencode`. models.dev publishes Go
    // its own mark, and the one it was borrowing was not even the right one.
    const go = connectionMark("opencode-go")!;
    expect(go.d).not.toBe(connectionMark("opencode")!.d);
    expect(renderToStaticMarkup(<ConnectionIcon connection="opencode-go" />)).toContain(go.d);
  });

  test("an unrouted OpenCode id falls back to the provider, which says nothing about an account", () => {
    const markup = renderToStaticMarkup(<ModelRowIcon driver="opencode" modelId="some-manually-added-id" />);
    expect(markup).toContain(OPENCODE_MARK.d);
    expect(markup).not.toContain(connectionMark("opencode")!.d);
  });

  test("the two-tone mark keeps both tones, dimmer block first", () => {
    // Drawn in two fills upstream; flattening it to one shape would be the
    // redrawing this directory's provenance rule forbids.
    expect(OPENCODE_MARK.dim).toBeString();
    const markup = renderToStaticMarkup(<ProviderIcon provider="opencode" size={14} />);
    expect(markup.indexOf(OPENCODE_MARK.dim!)).toBeLessThan(markup.indexOf(OPENCODE_MARK.d));
    expect(markup).toContain('opacity="0.45"');
  });
});

describe("a provider that serves several vendors under unrouted ids", () => {
  const markOf = (connection: string) => connectionMark(connection)!.d;
  const row = (modelId: string, driver = "cursor") => renderToStaticMarkup(<ModelRowIcon driver={driver} modelId={modelId} />);

  test("each row wears the vendor its id names", () => {
    expect(row("claude-opus-5-5[context=300k,effort=medium,fast=false]")).toContain(markOf("anthropic"));
    expect(row("gpt-5.6-sol[context=272k,reasoning=medium,fast=false]")).toContain(markOf("openai"));
    expect(row("o4-mini[]")).toContain(markOf("openai"));
    expect(row("gpt-5.3-codex[]")).toContain(markOf("openai"));
    expect(row("gemini-3.1-pro[]")).toContain(markOf("google"));
    expect(row("grok-4.7[fast=false]")).toContain(markOf("xai"));
    expect(row("muse-spark-1.3[]")).toContain(markOf("meta"));
  });

  test("its own models, Auto and anything unrecognised wear the provider's mark", () => {
    for (const id of ["composer-2.5[fast=true]", "default[]", "auto", "mystery-1"]) expect(row(id)).toContain(CURSOR_MARK.d);
  });

  test("the second line names the vendor, or the provider for its own models", () => {
    expect(modelVendorLabel("cursor", "claude-opus-5-5[]")).toBe("Anthropic");
    expect(modelVendorLabel("cursor", "grok-4.7[]")).toBe("xAI");
    expect(modelVendorLabel("cursor", "default[]")).toBe("Cursor");
    expect(modelVendorLabel("claude", "claude-opus-5")).toBeUndefined();
    expect(modelVendorLabel("opencode", "claude-sonnet")).toBeUndefined();
  });

  test("the pill shows the vendor of the chosen model, and the provider's mark on Auto", () => {
    expect(renderToStaticMarkup(<ModelPillIcon driver="cursor" modelId="claude-opus-5-5[]" />)).toContain(markOf("anthropic"));
    expect(renderToStaticMarkup(<ModelPillIcon driver="cursor" modelId="default[]" />)).toContain(CURSOR_MARK.d);
  });

  test("single-vendor drivers keep their own pill and row marks whatever the id says", () => {
    expect(renderToStaticMarkup(<ModelPillIcon driver="claude" modelId="claude-opus-5" />)).toContain("text-[#d97757]");
    expect(renderToStaticMarkup(<ModelPillIcon driver="opencode" modelId="openai/gpt-5.6" />)).toContain(OPENCODE_MARK.d);
    expect(row("gemini-like-id", "codex")).toContain(markOf("openai"));
    expect(row("gemini-3-pro", "opencode")).toContain(OPENCODE_MARK.d);
  });
});
