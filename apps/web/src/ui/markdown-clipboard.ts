type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const HREF_ATTRIBUTE = "data-markdown-href";
const SKIPPED = new Set(["BUTTON", "INPUT", "SCRIPT", "STYLE", "TEMPLATE", "svg"]);
const SKIPPED_PARTS = new Set(["code-block-header", "code-block-actions", "table-header", "table-actions"]);

/** Streamdown draws a gated link as a button with no href; this keeps the target on a wrapper the copy can read. */
export function rehypeLinkSources() {
  const visit = (node: HastNode) => {
    node.children = node.children?.map((child) => {
      visit(child);
      if (child.type !== "element" || child.tagName !== "a" || typeof child.properties?.href !== "string") return child;
      return { type: "element", tagName: "span", properties: { [HREF_ATTRIBUTE]: child.properties.href }, children: [child] };
    });
  };
  return visit;
}

function skipped(element: Element): boolean {
  if (SKIPPED.has(element.tagName) && element.getAttribute("data-streamdown") !== "link") return true;
  if (element.getAttribute("aria-hidden") === "true" || element.classList.contains("katex-mathml")) return true;
  return SKIPPED_PARTS.has(element.getAttribute("data-streamdown") ?? "");
}

function wrap(content: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  if (!match?.[2]) return content;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function inlineCode(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return `${fence}${pad}${code}${pad}${fence}`;
}

/** Streamdown draws each line as a block span with no newline between them. */
function codeLines(pre: Element): string {
  const lines = pre.querySelectorAll("code > span");
  const text = lines.length ? [...lines].map((line) => line.textContent ?? "").join("\n") : (pre.textContent ?? "");
  return text.replace(/\n$/, "");
}

function codeBlock(pre: Element, language: string): string {
  const code = codeLines(pre);
  const longest = Math.max(0, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language === "text" ? "" : language}\n${code}\n${fence}\n\n`;
}

function listItem(item: Element, ordered: boolean, index: number): string {
  const checkbox = item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
  const marker = `${ordered ? `${index}.` : "-"} ${checkbox ? `[${checkbox.checked ? "x" : " "}] ` : ""}`;
  const content = children(item).replace(/\n{2,}/g, "\n").trim();
  const indent = " ".repeat(marker.length);
  const [first = "", ...rest] = content.split("\n");
  return [`${marker}${first}`, ...rest.map((line) => (line ? `${indent}${line}` : line))].join("\n");
}

function list(element: Element, ordered: boolean): string {
  const start = Number.parseInt(element.getAttribute("start") ?? "1", 10) || 1;
  const items = [...element.children].filter((child) => child.tagName === "LI");
  return items.length ? `${items.map((item, index) => listItem(item, ordered, start + index)).join("\n")}\n\n` : "";
}

function table(element: Element): string {
  const rows = [...element.querySelectorAll("tr")].map((row) =>
    [...row.children].map((cell) => children(cell).replace(/\n+/g, " ").trim().replaceAll("|", "\\|")),
  );
  if (!rows.length) return "";
  const [head = [], ...body] = rows;
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return `${[line(head), line(head.map(() => "---")), ...body.map(line)].join("\n")}\n\n`;
}

function link(element: Element, href: string): string {
  const label = children(element).trim();
  if (!label) return "";
  return label === href || !/^(https?:|mailto:)/i.test(href) ? label : `[${label}](${href})`;
}

function children(node: Node): string {
  let out = "";
  for (const child of node.childNodes) out += serialize(child);
  return out;
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.includes("\n") && !text.trim() ? "\n" : text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (skipped(element)) return "";
  const href = element.getAttribute(HREF_ATTRIBUTE);
  if (href !== null) return link(element, href);
  const tex = element.classList.contains("katex") ? element.querySelector('annotation[encoding="application/x-tex"]')?.textContent : undefined;
  if (tex != null) return element.closest(".katex-display") ? `$$\n${tex}\n$$\n\n` : `$${tex}$`;

  const part = element.getAttribute("data-streamdown");
  if (part === "code-block") {
    const pre = element.querySelector("pre");
    return pre ? codeBlock(pre, element.getAttribute("data-language") ?? "") : "";
  }
  if (part === "strong") return wrap(children(element), "**");
  if (part === "link") return link(element, element.getAttribute("href") ?? "");

  const heading = /^H([1-6])$/.exec(element.tagName)?.[1];
  if (heading) return `${"#".repeat(Number(heading))} ${children(element).trim()}\n\n`;
  switch (element.tagName) {
    case "BR":
      return "\n";
    case "HR":
      return "---\n\n";
    case "P":
      return `${children(element).trim()}\n\n`;
    case "PRE":
      return codeBlock(element, element.closest("[data-language]")?.getAttribute("data-language") ?? "");
    case "CODE":
      return inlineCode(element.textContent ?? "");
    case "STRONG":
    case "B":
      return wrap(children(element), "**");
    case "EM":
    case "I":
      return wrap(children(element), "*");
    case "DEL":
    case "S":
      return wrap(children(element), "~~");
    case "A":
      return link(element, element.getAttribute("href") ?? "");
    case "IMG": {
      const src = element.getAttribute("src");
      return src ? `![${element.getAttribute("alt") ?? ""}](${src})` : "";
    }
    case "UL":
      return list(element, false);
    case "OL":
      return list(element, true);
    case "BLOCKQUOTE": {
      const content = children(element).replace(/\n{3,}/g, "\n\n").trim();
      return content ? `${content.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n")}\n\n` : "";
    }
    case "TABLE":
      return table(element);
    case "DIV": {
      const content = children(element);
      return content && !content.endsWith("\n") ? `${content}\n` : content;
    }
    default:
      return children(element);
  }
}

function tidy(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, index) => (index % 2 ? part : part.replace(/[ \t]+(?=\n)/g, "").replace(/\n{3,}/g, "\n\n")))
    .join("")
    .trim();
}

function fragmentMarkdown(fragment: Node): string {
  return tidy(children(fragment));
}

/** The Markdown for a selection, or undefined when the browser's own copy is right (inside one code block). */
export function selectionMarkdown(selection: Selection): string | undefined {
  const parts: string[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.collapsed) continue;
    const ancestor = range.commonAncestorContainer;
    if ((ancestor instanceof Element ? ancestor : ancestor.parentElement)?.closest("pre")) return undefined;
    const container = document.createElement("div");
    container.append(range.cloneContents());
    const markdown = fragmentMarkdown(container);
    if (markdown) parts.push(markdown);
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

export function copySelectionAsMarkdown(event: { clipboardData: DataTransfer | null; preventDefault(): void }): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !event.clipboardData) return;
  const markdown = selectionMarkdown(selection);
  if (markdown === undefined) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", markdown);
}
