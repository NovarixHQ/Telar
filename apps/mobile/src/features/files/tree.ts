import { buildFileTree, directoryPaths, flattenTree, matchFiles, type FileTreeRow } from "@telar/client/files";

export type FileListing = { rows: FileTreeRow[]; footer: string };

/** The tree as rows: every folder open except the ones closed by hand, and a search opens every folder holding a match. */
export function fileListing(paths: readonly string[], query: string, closed: ReadonlySet<string>, capped: boolean): FileListing {
  const found = matchFiles(paths, query);
  const tree = buildFileTree(found.files);
  const searching = query.trim() !== "";
  const open = new Set(directoryPaths(tree).filter((path) => searching || !closed.has(path)));
  const footer = searching
    ? found.truncated
      ? `First ${found.files.length} matches; ${found.matches - found.files.length} more not shown`
      : `${found.matches} ${found.matches === 1 ? "match" : "matches"}`
    : `${paths.length} ${paths.length === 1 ? "file" : "files"}${capped ? " (capped)" : ""}`;
  return { rows: flattenTree(tree, open), footer };
}
