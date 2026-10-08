import * as Clipboard from "expo-clipboard";
import { ActionSheetIOS, Alert } from "react-native";
import { hosts } from "../hosts";
import { inboxFor } from "./inboxes";
import type { RailRow } from "./rail";
import type { RowVerb } from "./row-actions";

type Patch = Parameters<NonNullable<ReturnType<typeof hosts.get>>["client"]["updateSession"]>[1];

async function onHost(hostId: string, run: (client: NonNullable<ReturnType<typeof hosts.get>>["client"]) => Promise<unknown>): Promise<void> {
  const host = hosts.get(hostId);
  if (!host) throw new Error("That computer is no longer paired.");
  await host.call(false, () => run(host.client));
  await inboxFor(hostId)?.refresh();
}

export const patchSession = (hostId: string, sessionId: string, patch: Patch) => onHost(hostId, (client) => client.updateSession(sessionId, patch));

export const patchRow = (row: RailRow, patch: Patch) => patchSession(row.hostId, row.sessionId, patch);

export const wakeRow = (row: RailRow) => patchRow(row, { settledOverride: "active", snoozedUntil: null });

function askTitle(row: RailRow): Promise<string | undefined> {
  return new Promise((resolve) =>
    Alert.prompt(
      "Rename session",
      undefined,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(undefined) },
        { text: "Rename", isPreferred: true, onPress: (text?: string) => resolve(text?.trim() || undefined) },
      ],
      "plain-text",
      row.title,
    ),
  );
}

function confirmDelete(row: RailRow): Promise<boolean> {
  return new Promise((resolve) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Delete “${row.title}”?`, message: "The conversation and everything it holds go with it. This cannot be undone.", options: ["Delete session", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (index) => resolve(index === 0),
    ),
  );
}

/** Carries out a menu or swipe verb; the rail refreshes once the computer answers. */
export async function runVerb(row: RailRow, verb: RowVerb): Promise<void> {
  switch (verb.kind) {
    case "pin":
      return patchRow(row, { settledOverride: verb.pinned ? "active" : null });
    case "settle":
      return onHost(row.hostId, (client) => client.settleSession(row.sessionId, verb.settled));
    case "snooze":
      return verb.until === null ? wakeRow(row) : patchRow(row, { snoozedUntil: verb.until });
    case "rename": {
      const title = await askTitle(row);
      if (title && title !== row.title) await patchRow(row, { title });
      return;
    }
    case "regenerate-title":
      return onHost(row.hostId, (client) => client.regenerateSessionTitle(row.sessionId));
    case "copy":
      await Clipboard.setStringAsync(verb.text);
      return;
    case "delete":
      if (await confirmDelete(row)) await onHost(row.hostId, (client) => client.deleteSession(row.sessionId));
      return;
  }
}
