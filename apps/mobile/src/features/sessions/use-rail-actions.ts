import { setStringAsync } from "expo-clipboard";
import { useCallback, useState } from "react";
import { ActionSheetIOS, Alert } from "react-native";
import { hosts } from "../hosts";
import { refreshInbox } from "./inboxes";
import { cockpitLink, requestFor, sendRailRequest, type RailAction } from "./rail-actions";
import type { RailRow } from "./rail";

type NewSession = { hostId: string; projectId: string; baseRef?: string };

/** Runs a rail row's actions: engine calls refresh the list, a failure is kept for the rail's error line. */
export function useRailActions(onNewSession: (target: NewSession) => void) {
  const [error, setError] = useState<string>();
  const [snoozing, setSnoozing] = useState<RailRow>();

  const send = useCallback(async (row: RailRow, action: RailAction) => {
    const request = requestFor(action);
    const host = hosts.get(row.hostId);
    if (!request || !host) return;
    try {
      await sendRailRequest(host, row.sessionId, request);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    await refreshInbox(row.hostId);
  }, []);

  const perform = useCallback(
    (row: RailRow, action: RailAction) => {
      switch (action.kind) {
        case "new-session":
          return onNewSession({ hostId: row.hostId, projectId: action.projectId, ...(action.baseRef ? { baseRef: action.baseRef } : {}) });
        case "copy":
          return void setStringAsync(action.text);
        case "rename":
          return Alert.prompt(
            "Rename session",
            undefined,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Rename", isPreferred: true, onPress: (next?: string) => void (next?.trim() && next.trim() !== row.title && send(row, { kind: "rename", title: next.trim() })) },
            ],
            "plain-text",
            row.title,
          );
        case "delete":
          return ActionSheetIOS.showActionSheetWithOptions(
            { title: `Delete “${row.title}”?`, message: "The conversation and everything it holds go with it. This cannot be undone.", options: ["Delete session", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
            (index) => void (index === 0 && send(row, action)),
          );
        default:
          return void send(row, action);
      }
    },
    [onNewSession, send],
  );

  const linkFor = useCallback((row: RailRow) => {
    const host = hosts.get(row.hostId);
    const base = host?.state.kind === "online" ? host.state.address : host?.addresses()[0];
    return base ? cockpitLink(base, row) : undefined;
  }, []);

  const saveProjectOrders = useCallback(async (orders: ReadonlyMap<string, string[]>) => {
    for (const [hostId, projectOrder] of orders) {
      const host = hosts.get(hostId);
      if (!host) continue;
      try {
        await host.call(false, () => host.client.setSidebarLayout({ projectOrder }));
        setError(undefined);
      } catch {
        setError("Couldn't save project order. Try again when the computer is connected.");
      }
      await refreshInbox(hostId);
    }
  }, []);

  return { error, perform, linkFor, snoozing, snooze: setSnoozing, saveProjectOrders };
}
