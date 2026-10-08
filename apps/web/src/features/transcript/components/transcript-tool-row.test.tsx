/**
 * #354 — "ds_scratch ds_scratch".
 *
 * A row is a verb and its salient argument. An MCP or plugin tool call had no
 * argument the lane knew how to read, so both halves fell back to the tool's
 * name — twice on one line, where the first line of the cell's code belonged.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UNKNOWN_PATH } from "@telar/engine-client";
import { TranscriptItem } from "./transcript-item";
import type { JournalItem } from "@/platform/engine";

const base = { runId: "run_1", sessionId: "session_1", startedAt: 1, streamedText: "", openedBy: 0 } as const;

const call = (name: string, input?: unknown, status: JournalItem["status"] = "completed"): JournalItem => ({
  ...base,
  id: "item_a",
  status,
  completedAt: 2,
  // The engine stores the display name as the row's title; that is the half
  // that was correct all along.
  title: name,
  detail: { type: "mcp_tool_call", call: { name, ...(input === undefined ? {} : { input }) } },
});

const render = (item: JournalItem) => renderToStaticMarkup(<TranscriptItem item={item} />);
/** Tags stripped, so "name name" is caught however the two spans are styled. */
const text = (item: JournalItem) => render(item).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("a tool row's argument", () => {
  test("the name is said once, and the code says the rest", () => {
    const html = text(call("ds_scratch", { code: "df = pd.read_csv(source)\ndf.describe()" }));
    expect(html).toContain("ds_scratch df = pd.read_csv(source)");
    // The second line stays behind the row's disclosure.
    expect(html).not.toContain("df.describe()");
    expect(html).not.toContain("ds_scratch ds_scratch");
  });

  test("a compile names the file it was handed", () => {
    expect(text(call("latex_compile", { path: "paper/main.tex" }))).toContain("latex_compile paper/main.tex");
  });

  test("a call with no readable input is the tool's name, once", () => {
    const html = text(call("ds_kernel"));
    expect(html).toContain("ds_kernel");
    expect(html).not.toContain("ds_kernel ds_kernel");
  });

  test("a running call shimmers the same one line", () => {
    const html = text(call("ds_scratch", { code: "plot(df)" }, "inProgress"));
    expect(html).toContain("ds_scratch · plot(df)");
  });
});

/**
 * "Edited: (unknown)" — a streamed edit's row opens before its input has named
 * the file, and it said so in the past tense with the placeholder for a path.
 */
describe("a file row whose path has not arrived", () => {
  const edit = (path: string, status: JournalItem["status"]): JournalItem => ({
    ...base,
    id: "item_c",
    status,
    ...(status === "inProgress" ? {} : { completedAt: 2 }),
    title: "Edit",
    detail: { type: "file_change", change: { path, kind: "edit" } },
  });

  test("while running, is a present-tense verb and no path", () => {
    const html = text(edit(UNKNOWN_PATH, "inProgress"));
    expect(html).toContain("Editing file…");
    expect(html).not.toContain(UNKNOWN_PATH);
    expect(html).not.toContain("Edited");
  });

  test("while running with its path, names it in the present tense", () => {
    expect(text(edit("src/a.ts", "inProgress"))).toContain("Editing file · src/a.ts");
  });

  test("once done, is the past-tense verb — and never the placeholder", () => {
    expect(text(edit("src/a.ts", "completed"))).toContain("Edited file a.ts");
    expect(render(edit("src/a.ts", "completed"))).toContain('title="src/a.ts"');
    const html = text(edit(UNKNOWN_PATH, "completed"));
    expect(html).toContain("Edited file");
    expect(html).not.toContain(UNKNOWN_PATH);
  });
});

/**
 * A PATCH THE JOURNAL COULD ONLY RECORD THE START OF — issue #694, §2.5.
 *
 * `unifiedDiff` used to announce its bound as `… diff truncated at 12000
 * characters …` on a line inside the patch, and the old `<pre>` printed it. The
 * parser that replaced that `<pre>` drops the line as unreadable, so the
 * warning had silently stopped arriving and a clipped patch read as a whole one.
 *
 * IT IS A FIELD NOW, AND IT IS DRAWN ON THE ROW rather than behind the
 * disclosure: the reader who needs to know is the one deciding whether to open
 * the row at all.
 */
describe("a file-change row whose patch was cut short (#694)", () => {
  const wrote = (over: Record<string, unknown>): JournalItem => ({
    ...base,
    id: "item_b",
    status: "completed",
    completedAt: 2,
    title: "Edit",
    detail: { type: "file_change", change: { path: "src/big.ts", kind: "edit", linesAdded: 4_000, linesRemoved: 12, ...over } } as JournalItem["detail"],
  });

  test("says so beside the counts, and the counts stay whole", () => {
    const html = text(wrote({ unifiedDiff: "diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts", diffTruncated: true }));
    expect(html).toContain("patch cut short");
    // The ± figures are counted from the HUNKS, so the bound on what is carried
    // does not shrink them — and saying "cut short" over shrunken counts would
    // be two different claims about one change.
    expect(html).toContain("+4000");
    expect(html).toContain("−12");
  });

  test("an ordinary patch says nothing, so the badge is a claim", () => {
    expect(text(wrote({ unifiedDiff: "diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts" }))).not.toContain("patch cut short");
  });
});

describe("a tool row in human words", () => {
  const tool = (name: string, input: unknown, over: Partial<JournalItem> = {}): JournalItem => ({
    ...base,
    id: "item_h",
    status: "completed",
    completedAt: 2,
    title: name,
    detail: name.startsWith("mcp__")
      ? { type: "mcp_tool_call", call: { name, server: name.split("__")[1]!, input } }
      : { type: "dynamic_tool_call", call: { name, input } },
    ...over,
  });

  test("a command is the verb and its first line", () => {
    const run: JournalItem = { ...base, id: "c", status: "completed", completedAt: 2, title: "bun test", detail: { type: "command_execution", command: { command: "bun test\necho done" } } };
    const html = text(run);
    expect(html).toContain("Ran command bun test");
    expect(html).not.toContain("echo done");
  });

  test("a read names its file as a chip", () => {
    const read: JournalItem = { ...base, id: "r", status: "completed", completedAt: 2, title: "/repo/src/looks.ts", detail: { type: "file_read", read: { path: "/repo/src/looks.ts" } } };
    expect(text(read)).toBe("Read file looks.ts");
    expect(render(read)).toContain('title="/repo/src/looks.ts"');
  });

  test("an edit from a provider that only names the tool is still an edit of its file", () => {
    expect(text(tool("edit", { filePath: "src/a.ts" }))).toBe("Edited file a.ts");
  });

  test("a search says what it looked for", () => {
    expect(text(tool("Grep", { pattern: "toolWords", path: "src" }))).toBe("Searched toolWords");
    expect(text(tool("Glob", { pattern: "**/*.tsx" }))).toBe("Searched **/*.tsx");
    expect(text(tool("Grep", { pattern: "x" }, { status: "inProgress" }))).toContain("Searching · x");
  });

  test("a fetch and a web search say so", () => {
    expect(text(tool("WebFetch", { url: "https://bun.sh/docs" }))).toBe("Fetched https://bun.sh/docs");
    expect(text(tool("WebSearch", { query: "bun test" }))).toBe("Searched web bun test");
  });

  test("loading tools lists them without their server prefix", () => {
    const html = text(tool("ToolSearch", { query: "select:mcp__telar__sessions_read,mcp__telar__sessions_send" }));
    expect(html).toBe("Loaded tools sessions_read, sessions_send");
  });

  test("Telar's own tools read as what they did", () => {
    expect(text(tool("mcp__telar__display_preview", { html: "<!doctype html><p>hi</p>" }))).toBe("Previewed a page");
    expect(text(tool("mcp__telar__display_inline", { html: "<p>x</p>", title: "Chart" }))).toBe("Showed a page Chart");
    expect(text(tool("mcp__telar__terminal_run", { command: "bun run dev", terminalId: "t1" }))).toBe("Ran in terminal bun run dev");
    expect(text(tool("mcp__telar__sessions_handoff", { sessionId: "s" }))).toBe("Sessions handoff");
  });

  test("a browser call names the host it went to", () => {
    const go: JournalItem = { ...base, id: "b", status: "completed", completedAt: 2, title: "browser_navigate", detail: { type: "browser_action", call: { name: "mcp__telar-browser__browser_navigate", server: "telar-browser", input: { url: "https://example.com/a" } }, url: "https://example.com/a" } };
    expect(text(go)).toBe("Browsed example.com");
  });

  test("an unknown server's tool is named in words, never by its qualified name", () => {
    const html = text(tool("mcp__linear__create_issue", { title: "Fix rows" }));
    expect(html).toBe("Linear · Create issue Fix rows");
    expect(html).not.toContain("mcp__");
  });
});
