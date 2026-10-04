"use client";

import { type SetStateAction, useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Session } from "@telar/engine-client";
import { asEngineError, createEngineApi, isActiveTurn, loadOlderTurns, tailIntervalMs, type EngineApiError, type HydratedSession } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { usePoll } from "@/ui/hooks/use-poll";
import { headConnection, headKey, headStore, openHead, saveHead } from "../../session-heads";
import { decideStale } from "../stale-state";
import { emptySessionData, sessionDataReducer, type SessionData } from "../session-data";

const PHOTOGRAPHED = ["session", "turns", "items", "tasks", "requests", "events"] as const;
type Photo = { id: string } & Pick<HydratedSession, (typeof PHOTOGRAPHED)[number]>;

/** Records identities, not contents, so a tail that changed nothing is not written again. */
function persist(photographed: { current: Photo | undefined }, host: string, id: string, head: HydratedSession) {
  const store = headStore();
  if (!store) return;
  const held = photographed.current;
  if (held && held.id === id && PHOTOGRAPHED.every((field) => held[field] === head[field])) return;
  photographed.current = { id, ...Object.fromEntries(PHOTOGRAPHED.map((field) => [field, head[field]])) } as Photo;
  void saveHead(store, headKey(host, id), head).catch(() => undefined);
}

function staleSince(code: string | undefined, savedAt: number | undefined, liveAt: number | undefined): number | undefined {
  return decideStale({
    hasContent: savedAt !== undefined || liveAt !== undefined,
    ...(code === undefined ? {} : { code }),
    ...(savedAt === undefined ? {} : { cachedAt: savedAt }),
    ...(liveAt === undefined ? {} : { lastLiveAt: liveAt }),
  });
}

/** What the first render can paint without waiting: the head this tab already holds in memory. */
function heldData(hostId: string, sessionId: string | undefined, readKey: string): SessionData {
  const head = sessionId ? headConnection(hostId, sessionId).peek() : undefined;
  return head ? { ...head, readKey } : emptySessionData;
}

export function useSessionSync({ hostId, sessionId, initiallyLoading }: { hostId: string; sessionId: string | undefined; initiallyLoading: boolean }) {
  const syncKey = JSON.stringify([hostId, sessionId]);
  const [data, dispatch] = useReducer(sessionDataReducer, syncKey, (key) => heldData(hostId, sessionId, key));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<EngineApiError>();
  const [stale, setStale] = useState<number>();
  /** `savedAt` of a head on screen the engine has not confirmed yet. */
  const cachedAt = useRef<number | undefined>(undefined);
  const lastLiveAt = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(() => initiallyLoading && data.readKey !== syncKey);
  /** The last opening the engine answered; until it matches, what is on screen may be a cached head. */
  const [reconciled, setReconciled] = useState<string>();
  const photographed = useRef<Photo>(undefined);
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const syncSession = useRef(syncKey);
  const syncGeneration = useRef(0);
  const tailInFlight = useRef(false);
  const transcriptLanded = !sessionId || data.readKey === syncKey;

  const [transcriptSubject, setTranscriptSubject] = useState(syncKey);
  if (transcriptSubject !== syncKey) {
    setTranscriptSubject(syncKey);
    const held = heldData(hostId, sessionId, syncKey);
    if (held.readKey) dispatch({ type: "replace", data: held, readKey: syncKey });
  }

  useEffect(() => {
    if (syncSession.current === syncKey) return;
    syncSession.current = syncKey;
    syncGeneration.current += 1;
    syncQueue.current = Promise.resolve();
    tailInFlight.current = false;
  }, [syncKey]);

  const enqueueSync = useCallback((operation: () => Promise<void>) => {
    const next = syncQueue.current.then(operation, operation);
    syncQueue.current = next.catch(() => undefined);
    return next;
  }, []);
  /** Any answer, even an empty tail, proves the engine is reachable and clears the banner. */
  const remember = useCallback((id: string, head: HydratedSession, opened = false) => {
    lastLiveAt.current = Date.now();
    cachedAt.current = undefined;
    setStale(undefined);
    // Saved on opening and whenever a turn settles, so a streaming turn is not folded every tick.
    if (opened || !head.turns.some((turn) => isActiveTurn(turn.state))) persist(photographed, hostId, id, head);
  }, [hostId]);
  const fail = useCallback((cause: unknown, fallback: string) => {
    const failure = asEngineError(cause, fallback);
    const at = staleSince(failure.code, cachedAt.current, lastLiveAt.current);
    if (at === undefined) {
      setError(failure);
      return;
    }
    setError(undefined);
    setStale(at);
  }, []);
  const pull = useCallback(
    (type: "replace" | "tail") =>
      enqueueSync(async () => {
        if (!sessionId) return;
        const generation = syncGeneration.current;
        const snapshot = await headConnection(hostId, sessionId).read();
        if (generation !== syncGeneration.current || syncSession.current !== syncKey) return;
        dispatch(type === "replace" ? { type, data: snapshot, readKey: syncKey } : { type, data: snapshot });
        remember(sessionId, snapshot);
      }),
    [enqueueSync, sessionId, remember, hostId, syncKey],
  );
  const hydrate = useCallback(() => pull("replace"), [pull]);
  const page = data.page;
  const loadOlder = useCallback(() => {
    const before = page?.before;
    if (!sessionId || !before || loadingOlder) return;
    setLoadingOlder(true);
    void enqueueSync(async () => {
      const generation = syncGeneration.current;
      const older = await loadOlderTurns(createEngineApi(hostFetcher(hostId)), sessionId, before);
      if (generation !== syncGeneration.current || syncSession.current !== syncKey) return;
      dispatch({ type: "older", data: older });
    })
      .catch((cause) => setError(asEngineError(cause, "Could not load earlier turns.")))
      .finally(() => setLoadingOlder(false));
  }, [enqueueSync, sessionId, page, loadingOlder, syncKey, hostId]);

  const open = useCallback(
    () =>
      enqueueSync(async () => {
        if (!sessionId) return;
        const generation = syncGeneration.current;
        const current = () => generation === syncGeneration.current && syncSession.current === syncKey;
        const connection = headConnection(hostId, sessionId);
        if (connection.peek()) cachedAt.current = connection.readAt;
        const { held, reconciled } = openHead(hostId, sessionId);
        const painted = held && (await held);
        if (painted && current()) {
          cachedAt.current = connection.readAt;
          dispatch({ type: "replace", data: painted, readKey: syncKey });
          setLoading(false);
        }
        const head = await reconciled;
        if (!current()) return;
        dispatch({ type: "replace", data: head, readKey: syncKey });
        remember(sessionId, head, true);
      }),
    [enqueueSync, sessionId, hostId, syncKey, remember],
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    lastLiveAt.current = undefined;
    cachedAt.current = undefined;
    void open()
      .then(
        () => !cancelled && setError(undefined),
        (cause) => {
          if (cancelled) return;
          fail(cause, "Could not hydrate this session.");
          dispatch({ type: "landed", readKey: syncKey });
        },
      )
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setReconciled(syncKey);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, fail, syncKey]);

  usePoll((signal) => {
    if (tailInFlight.current) return;
    tailInFlight.current = true;
    const generation = syncGeneration.current;
    return pull("tail")
      .catch((cause) => !signal.aborted && fail(cause, "Could not tail the session journal."))
      .finally(() => {
        if (generation === syncGeneration.current) tailInFlight.current = false;
      });
  }, sessionId ? tailIntervalMs(data.turns) : null, { immediate: false, key: syncKey });

  const setSession = useCallback((next: SetStateAction<Session | undefined>) => dispatch({ type: "session", next }), []);
  const clearTranscript = useCallback(() => dispatch({ type: "clear" }), []);
  const session = sessionId ? data.session : undefined;
  return { ...data, session, setSession, clearTranscript, loadOlder, loadingOlder, error, setError, stale, loading, updating: Boolean(sessionId) && reconciled !== syncKey, syncKey, transcriptLanded, hydrate };
}
