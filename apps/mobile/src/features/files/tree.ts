import type { GitFileChange } from "@telar/engine-client";
import type { SymbolName, ThemeColor } from "../../ui";

export type FileNode = { path: string; name: string; children?: FileNode[] };
export type FileRow = { node: FileNode; depth: number };

type Building = { dirs: Map<string, Building>; files: string[] };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function compare(left: FileNode, right: FileNode): number {
  if (!!left.children !== !!right.children) return left.children ? -1 : 1;
  return collator.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function toNodes(building: Building, prefix: string): FileNode[] {
  const join = (name: string) => (prefix ? `${prefix}/${name}` : name);
  const dirs = [...building.dirs].map(([name, child]): FileNode => ({ path: join(name), name, children: toNodes(child, join(name)) }));
  const files = building.files.map((name): FileNode => ({ path: join(name), name }));
  return [...dirs, ...files].sort(compare);
}

/** A directory whose only child is a directory reads as one row: "src/features". */
function collapse(node: FileNode): FileNode {
  if (!node.children) return node;
  const children = node.children.map(collapse);
  const only = children.length === 1 ? children[0]! : undefined;
  if (only?.children) return { path: only.path, name: `${node.name}/${only.name}`, children: only.children };
  return { ...node, children };
}

export function buildFileTree(paths: readonly string[]): FileNode[] {
  const root: Building = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;
    let cursor = root;
    for (const segment of segments) {
      let next = cursor.dirs.get(segment);
      if (!next) cursor.dirs.set(segment, (next = { dirs: new Map(), files: [] }));
      cursor = next;
    }
    cursor.files.push(name);
  }
  return toNodes(root, "").map(collapse);
}

export function flattenTree(nodes: readonly FileNode[], expanded: ReadonlySet<string>, depth = 0): FileRow[] {
  return nodes.flatMap((node) => [{ node, depth }, ...(node.children && expanded.has(node.path) ? flattenTree(node.children, expanded, depth + 1) : [])]);
}

export const directoryPaths = (nodes: readonly FileNode[]): string[] => nodes.flatMap((node) => (node.children ? [node.path, ...directoryPaths(node.children)] : []));

export const MAX_SEARCH_MATCHES = 400;

export function matchFiles(paths: readonly string[], query: string): { matches: readonly string[]; dropped: number } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: paths, dropped: 0 };
  const hits = paths.filter((path) => path.toLowerCase().includes(needle));
  return { matches: hits.slice(0, MAX_SEARCH_MATCHES), dropped: Math.max(0, hits.length - MAX_SEARCH_MATCHES) };
}

const extension = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const GLYPHS: [SymbolName, string[]][] = [
  ["text.book.closed", ["ipynb"]],
  ["tablecells", ["csv", "tsv", "parquet"]],
  ["doc.richtext", ["pdf"]],
  ["photo", ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"]],
  ["doc.text", ["md", "markdown", "txt", "rst"]],
  ["curlybraces", ["json", "yaml", "yml", "toml"]],
  ["chevron.left.forwardslash.chevron.right", ["py", "ts", "tsx", "js", "jsx", "swift", "rs", "go", "rb", "java", "c", "h", "cpp", "cs", "kt"]],
  ["function", ["tex", "bib", "sty", "cls"]],
  ["terminal", ["sh", "bash", "zsh"]],
];

export function fileGlyph(path: string): SymbolName {
  const ext = extension(path);
  return GLYPHS.find(([, extensions]) => extensions.includes(ext))?.[0] ?? "doc";
}

/** Prose is read as wrapped text; everything else as code. */
export const isProse = (path: string) => ["md", "markdown", "txt", "rst", "text"].includes(extension(path));

export function statusMark(status: GitFileChange["status"]): { letter: string; tone: ThemeColor } {
  switch (status) {
    case "added":
      return { letter: "A", tone: "emerald" };
    case "untracked":
      return { letter: "?", tone: "emerald" };
    case "deleted":
      return { letter: "D", tone: "red" };
    case "renamed":
      return { letter: "R", tone: "amber" };
    default:
      return { letter: "M", tone: "amber" };
  }
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
