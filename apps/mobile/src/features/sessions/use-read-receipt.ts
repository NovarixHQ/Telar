import { useIsFocused } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { newestResultTurn, ReadReceiptCourier } from "@telar/client/read-receipt";
import type { HydratedSession } from "@telar/client/journal";
import type { HostConnection } from "../../platform/connection";
import { refreshInbox } from "./inboxes";

function useForeground(): boolean {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return focused && active;
}

/** Marks the session read on its host once the newest answer is on screen with the app in front, like the cockpit. */
export function useReadReceipt(host: HostConnection | undefined, sessionId: string, head: HydratedSession | undefined) {
  const candidate = useMemo(() => (head ? newestResultTurn(head.turns) : undefined), [head?.turns]);
  const readSequence = head?.session.lastReadTurnSequence;
  const foreground = useForeground();
  const [visibleRunId, setVisibleRunId] = useState<string>();

  const courier = useRef<ReadReceiptCourier | undefined>(undefined);
  useEffect(() => {
    if (!host) return;
    const created = new ReadReceiptCourier({
      send: (identity, runId) => host.call(false, () => host.client.markSessionRead(identity.sessionId, runId)).then((answer) => answer.session),
      onRead: (identity) => void refreshInbox(identity.hostId),
      setTimer: (run, delayMs) => setTimeout(run, delayMs),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
    courier.current = created;
    return () => created.dispose();
  }, [host]);

  const loaded = head !== undefined;
  useEffect(() => {
    courier.current?.update({
      ...(host && loaded ? { identity: { hostId: host.hostId, sessionId } } : {}),
      ...(candidate ? { candidate } : {}),
      ...(readSequence === undefined ? {} : { readSequence }),
      gate: { foreground, atLatestResult: candidate !== undefined && visibleRunId === candidate.runId, loading: !loaded },
    });
  }, [host, sessionId, loaded, candidate, readSequence, foreground, visibleRunId]);

  const runId = candidate?.runId;
  return useMemo(
    () => (runId ? { runId, onVisible: (visible: boolean) => setVisibleRunId((current) => (visible ? runId : current === runId ? undefined : current)) } : undefined),
    [runId],
  );
}
