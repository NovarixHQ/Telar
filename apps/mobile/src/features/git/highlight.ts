import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const GRAMMARS = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, makefile, markdown, objectivec, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);

type Language = keyof typeof GRAMMARS;

const BY_NAME: Record<string, Language> = { dockerfile: "dockerfile", containerfile: "dockerfile", makefile: "makefile", gnumakefile: "makefile", ".env": "ini" };
const BY_EXTENSION: Record<string, Language> = {
  swift: "swift", py: "python", pyi: "python", pyw: "python", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", rs: "rust", go: "go", rb: "ruby", rake: "ruby", java: "java",
  kt: "kotlin", kts: "kotlin", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", m: "objectivec", mm: "objectivec",
  cs: "csharp", php: "php", sh: "bash", bash: "bash", zsh: "bash", fish: "bash", json: "json", jsonc: "json", ipynb: "json", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", cfg: "ini", conf: "ini", xml: "xml", plist: "xml", storyboard: "xml", xib: "xml", svg: "xml", html: "xml", htm: "xml",
  css: "css", scss: "scss", sass: "scss", sql: "sql", md: "markdown", markdown: "markdown", diff: "diff", patch: "diff",
};

/** The grammar for a path, by file name then extension, as the Swift app picks it. */
export function languageFor(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  return BY_NAME[name] ?? (dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined);
}

/** A run of code and the highlight.js class lists around it, innermost last. */
export type Token = { text: string; scopes: string[] };

const SIZE_CAP = 200 * 1024;
const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
const decode = (html: string) => html.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITY[entity]!);
const MARKUP = /<span class="([^"]+)">|<\/span>/g;

function tokenLines(html: string): Token[][] {
  const lines: Token[][] = [[]];
  const stack: string[] = [];
  const push = (raw: string) => {
    const scopes = [...stack];
    decode(raw)
      .split("\n")
      .forEach((text, index) => {
        if (index > 0) lines.push([]);
        if (text) lines.at(-1)!.push({ text, scopes });
      });
  };
  let at = 0;
  for (const match of html.matchAll(MARKUP)) {
    push(html.slice(at, match.index));
    if (match[1]) stack.push(match[1]);
    else stack.pop();
    at = match.index + match[0].length;
  }
  push(html.slice(at));
  return lines;
}

/** Highlights lines as one block, so strings and comments that span lines colour right, then splits them back. */
export function highlightLines(lines: string[], language: Language | undefined): Token[][] | undefined {
  const code = lines.join("\n");
  if (!language || code.length > SIZE_CAP) return undefined;
  try {
    return tokenLines(hljs.highlight(code, { language, ignoreIllegals: true }).value);
  } catch {
    return undefined;
  }
}
