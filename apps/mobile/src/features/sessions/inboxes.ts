import { AppState } from "react-native";
import { hosts } from "../hosts";
import { Inbox, type InboxSnapshot } from "./inbox";

export type HostSnapshot = { hostId: string; snapshot: InboxSnapshot };

const inboxes = new Map<string, Inbox>();
const listeners = new Set<() => void>();
let snapshot: HostSnapshot[] = [];

function sync(): void {
  const live = new Set(hosts.list().map((connection) => connection.hostId));
  for (const [hostId, inbox] of inboxes) {
    if (live.has(hostId)) continue;
    inbox.stop();
    inboxes.delete(hostId);
  }
  for (const connection of hosts.list()) {
    if (inboxes.has(connection.hostId)) continue;
    const inbox = new Inbox(connection);
    inbox.subscribe(() => notify());
    inbox.setForeground(AppState.currentState !== "background");
    inbox.start();
    inboxes.set(connection.hostId, inbox);
  }
  notify();
}

function notify(): void {
  snapshot = [...inboxes].map(([hostId, inbox]) => ({ hostId, snapshot: inbox.snapshot }));
  for (const listener of listeners) listener();
}

export function inboxFor(hostId: string): Inbox | undefined {
  return inboxes.get(hostId);
}

export async function refreshInbox(hostId: string): Promise<void> {
  await inboxes.get(hostId)?.refresh();
}

export const inboxStore = {
  read: (): HostSnapshot[] => snapshot,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

hosts.subscribe(sync);
sync();
AppState.addEventListener("change", (state) => {
  for (const inbox of inboxes.values()) inbox.setForeground(state === "active");
});
