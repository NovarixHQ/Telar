import hljs from "highlight.js/lib/common";
import { Marked, type Token, type TokenizerExtension } from "marked";

export type { Token };

/** `$$…$$` on its own lines, or alone on one line between blank lines, as the Swift app treats it. */
const mathBlock: TokenizerExtension = {
  name: "mathBlock",
  level: "block",
  start: (src) => src.match(/^ {0,3}\$\$/m)?.index,
  tokenizer(src) {
    const match = /^ {0,3}\$\$[ \t]*\n([\s\S]+?)\n {0,3}\$\$[ \t]*(?:\n+|$)/.exec(src) ?? /^ {0,3}\$\$([^\n]+?)\$\$[ \t]*(?:\n[ \t]*\n+|\n?$)/.exec(src);
    return match ? { type: "mathBlock", raw: match[0], text: match[1]!.trim() } : undefined;
  },
};

const mathInline: TokenizerExtension = {
  name: "mathInline",
  level: "inline",
  start: (src) => src.indexOf("$$"),
  tokenizer(src) {
    const match = /^\$\$([^\n]+?)\$\$/.exec(src);
    return match ? { type: "mathInline", raw: match[0], text: match[1]!.trim() } : undefined;
  },
};

const marked = new Marked({ gfm: true, extensions: [mathBlock, mathInline] });

export function markdownBlocks(text: string): Token[] {
  return marked.lexer(text);
}

const plainInline = (token: Token): boolean => (token.type === "text" || token.type === "escape") && (!("tokens" in token) || !token.tokens || token.tokens.every(plainInline));

export function isPlainProse(text: string): boolean {
  return markdownBlocks(text).every((block) => block.type === "space" || (block.type === "paragraph" && (block.tokens ?? []).every(plainInline)));
}

const FENCE_ALIASES: Record<string, string | null> = {
  sh: "bash", shell: "bash", console: "bash", zsh: "bash",
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", node: "javascript",
  py: "python", python3: "python", yml: "yaml", rb: "ruby", rs: "rust",
  objc: "objectivec", "objective-c": "objectivec", "c++": "cpp", "c#": "csharp", cs: "csharp",
  html: "xml", plist: "xml", toml: "ini", conf: "ini", tex: "latex",
  text: null, txt: null, plain: null, plaintext: null, none: null,
};

/** The highlighter's language for a fence's info string, or nothing when it should stay plain. */
export function fencedLanguage(info: string | undefined): string | undefined {
  const first = info?.trim().split(/[ ,{}.]/)[0]?.toLowerCase();
  if (!first) return undefined;
  const name = first in FENCE_ALIASES ? FENCE_ALIASES[first] : first;
  return name && hljs.getLanguage(name) ? name : undefined;
}

export type CodeSpan = { text: string; scope?: string };

const HIGHLIGHT_CAP = 200 * 1024;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
const decode = (html: string) => html.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** Code split into runs, each tagged with the innermost highlight.js scope that covers it. */
export function highlightCode(code: string, language: string | undefined): CodeSpan[] {
  if (!language || code.length > HIGHLIGHT_CAP) return [{ text: code }];
  const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  const spans: CodeSpan[] = [];
  const scopes: string[] = [];
  for (const [part, scope] of html.matchAll(/<span class="([^"]+)">|<\/span>|[^<]+/g)) {
    if (scope) scopes.push(scope.replace(/^hljs-/, ""));
    else if (part === "</span>") scopes.pop();
    else spans.push(scopes.length ? { text: decode(part), scope: scopes.at(-1)! } : { text: decode(part) });
  }
  return spans;
}
