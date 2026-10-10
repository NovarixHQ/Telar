/**
 * WHO DECIDES THAT A PLUGIN'S TOOL IS A READ — and does BOTH providers agree.
 *
 * Two root-review conditions meet in this file:
 *
 *   1. The HOST owns approval policy. A plugin manifest's `readTools` is a
 *      claim, and a claim is not a grant: `plugins/policy.ts` holds the table
 *      that actually classifies, and a plugin editing its own manifest cannot
 *      widen what it is allowed to do without an approval card.
 *   2. The answer must be THE SAME ON CLAUDE AND ON CODEX. The two providers ask
 *      the question through completely different wires — Claude reports a
 *      qualified tool name, Codex sends an MCP *elicitation* with the approval
 *      hidden in `_meta` — and before this change the Codex arm answered
 *      `"tool_call"` unconditionally. That made `display_open` auto-accept
 *      under one provider and park a card under the other, for the same read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { codexApprovalRequest, MCP_ELICITATION } from "../../drivers/codex";
import { requestKindForTool, setPluginReadTools } from "../../drivers/claude";
import { PluginManifest, type PluginMeta } from "@telar/engine-client";
import { dataSciencePlugin } from "../../../plugins/data-science";
import { latexPlugin } from "../../../plugins/latex";
import { manifestMeta } from "./manifest";
import { ratifiedReadTools } from "./policy";

const dataScienceMeta = manifestMeta(PluginManifest.parse(dataSciencePlugin.manifest));
const latexMeta = manifestMeta(PluginManifest.parse(latexPlugin.manifest));
const meta = (extra: Partial<PluginMeta>): PluginMeta => ({ ...latexMeta, ...extra });

beforeEach(() => setPluginReadTools(ratifiedReadTools({ meta: dataScienceMeta })));
afterEach(() => setPluginReadTools([]));

/** How Codex asks. The tool name lives only inside the prose. */
const codexAsks = (server: string, tool: string) =>
  codexApprovalRequest(MCP_ELICITATION, {
    serverName: server,
    message: `Allow the ${server} MCP server to run tool "${tool}"?`,
    _meta: { codex_approval_kind: "mcp_tool_call", tool_params: {} },
  });

/** How Claude asks: the qualified name, classified directly. */
const claudeAsks = (server: string, tool: string) => requestKindForTool(`mcp__${server}__${tool}`);

describe("both providers classify a tool the same way", () => {
  const cases: { tool: string; kind: string; why: string }[] = [
    { tool: "display_open", kind: "file_read", why: "a core read" },
    { tool: "ds_packages", kind: "file_read", why: "a plugin read the host ratified" },
    { tool: "ds_kernel", kind: "file_read", why: "a plugin read the host ratified" },
    { tool: "notebook_run_cell", kind: "tool_call", why: "a plugin tool that executes" },
    { tool: "ds_install", kind: "tool_call", why: "a plugin tool that writes to the environment" },
    { tool: "latex_compile", kind: "tool_call", why: "a plugin tool that writes" },
    { tool: "latex_status", kind: "tool_call", why: "NOT promoted by the migration" },
    { tool: "sessions_create", kind: "tool_call", why: "a core write" },
  ];

  for (const { tool, kind, why } of cases) {
    test(`${tool} is ${kind} on both providers — ${why}`, () => {
      expect(claudeAsks("telar", tool)).toBe(kind as never);
      expect(codexAsks("telar", tool)?.kind).toBe(kind as never);
    });
  }

  test("a user's own MCP server never inherits the engine's posture, on either provider", () => {
    // Somebody else's server naming a tool `ds_packages` gets no privilege from
    // the coincidence.
    expect(claudeAsks("linear", "ds_packages")).toBe("tool_call");
    expect(codexAsks("linear", "ds_packages")?.kind).toBe("tool_call");
  });

  test("the Codex card still names the tool the way every other row names it", () => {
    // Parity of KIND must not have cost the detail its identity: an approval
    // card and the timeline row it is about spell the same string.
    const request = codexAsks("telar", "ds_packages");
    expect(request?.detail).toMatchObject({
      kind: "tool_call",
      call: { name: "mcp__telar__ds_packages", server: "telar" },
    });
  });

  test("an elicitation that is not an approval is still declined by both", () => {
    // A server legitimately eliciting input — a form, a URL — has no
    // `codex_approval_kind`, and the engine has no answer to invent.
    expect(codexApprovalRequest(MCP_ELICITATION, { serverName: "linear", message: "Pick one" })).toBeNull();
  });
});

describe("a self-declared read claim is not a grant", () => {
  test("an installed plugin claiming reads gets nothing, whatever it claims", () => {
    const granted = ratifiedReadTools({ meta: meta({ readTools: ["latex_status", "latex_compile"] }), installed: {} });
    expect(granted).toEqual([]);
  });

  test("installing an installed plugin's hostile claim does not change the answer on either provider", () => {
    setPluginReadTools(ratifiedReadTools({ meta: meta({ readTools: ["latex_compile"] }), installed: {} }));
    expect(claudeAsks("telar", "latex_compile")).toBe("tool_call");
    expect(codexAsks("telar", "latex_compile")?.kind).toBe("tool_call");
  });

  test("a plugin cannot borrow another plugin's namespace", () => {
    expect(ratifiedReadTools({ meta: meta({ readTools: ["ds_kernel"] }) })).toEqual([]);
  });
});

describe("the driver's default and the host's installation", () => {
  test("the cold default asks for everything, so an uninstalled process fails closed", () => {
    setPluginReadTools([]);
    expect(requestKindForTool("mcp__telar__ds_packages")).toBe("tool_call");
  });

  test("the host can only narrow — installing an empty set removes plugin reads, not core ones", () => {
    setPluginReadTools(new Set());
    expect(requestKindForTool("mcp__telar__ds_packages")).toBe("tool_call");
    expect(requestKindForTool("mcp__telar__display_open")).toBe("file_read");
  });
});
