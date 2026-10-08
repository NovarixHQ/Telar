// `connect` alone adds a computer; `connect:hostId` edits how that one is reached.
const pages = ["general", "appearance", "notifications", "sound", "connect"] as const;
const hostPages = ["host", "connect", "devices", "dictation", "vocabulary", "simulators"] as const;

export type Destination = { page: (typeof pages)[number] } | { page: (typeof hostPages)[number]; hostId: string };

/** NavigationStack path values: a page name, or `page:hostId` for a computer's own pages. */
export function destinationValue(destination: Destination): string {
  return "hostId" in destination ? `${destination.page}:${destination.hostId}` : destination.page;
}

export function parseDestination(value: string): Destination | undefined {
  const split = value.indexOf(":");
  if (split < 0) return pages.find((page) => page === value) && { page: value as (typeof pages)[number] };
  const page = hostPages.find((candidate) => candidate === value.slice(0, split));
  const hostId = value.slice(split + 1);
  return page && hostId ? { page, hostId } : undefined;
}
