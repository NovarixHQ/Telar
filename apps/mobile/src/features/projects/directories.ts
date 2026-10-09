import type { DirectoryListing, Project } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

export type FolderPath = { ok: true; path: string } | { ok: false; message: string };

/** A typed or pasted folder: quotes and trailing slashes dropped, and it has to start at `/` or `~`. */
export function parseFolderPath(raw: string): FolderPath {
  let text = raw.trim();
  for (const quote of ['"', "'"]) if (text.length >= 2 && text.startsWith(quote) && text.endsWith(quote)) text = text.slice(1, -1);
  if (!text) return { ok: false, message: "Type or paste a folder path." };
  if (!(text.startsWith("/") || text === "~" || text.startsWith("~/"))) return { ok: false, message: "A folder path has to start with / or ~." };
  while (text.length > 1 && text.endsWith("/")) text = text.slice(0, -1);
  return { ok: true, path: text };
}

/** Volumes and other roots besides the one being shown. */
export function otherRoots(listing: DirectoryListing): { name: string; path: string }[] {
  return listing.roots.filter((root) => root.path !== listing.path);
}

/** The host's folders at `path`, or where the engine starts browsing when there is none. */
export function listDirectories(host: HostConnection, path?: string): Promise<DirectoryListing> {
  return host.request("GET", path ? `/v2/fs?${new URLSearchParams({ path }).toString()}` : "/v2/fs");
}

export async function registerProject(host: HostConnection, root: string, name: string, fallback: string): Promise<Project> {
  const { project } = await host.call(false, () => host.client.registerProject({ name: name.trim() || fallback, root }));
  return project;
}
