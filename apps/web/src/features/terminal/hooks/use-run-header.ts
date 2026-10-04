"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { createRunApi, type RunApi } from "../run/api";
import { useRunStatusFeed } from "../run/status-stream";
import type { RunConfigurationDraft, RunConfigurationView, RunView } from "../run/types";

type Channel = "configs";
export type ReadToken = { channel: Channel; generation: number; seq: number };

/** An answer is stale once a mutation or unmount bumped the generation, or a newer read on its channel opened. */
export function createReadGuard() {
  let generation = 0;
  const newest: Record<Channel, number> = { configs: 0 };
  const open = (channel: Channel): ReadToken => ({ channel, generation, seq: (newest[channel] += 1) });
  return {
    open,
    stale: (token: ReadToken) => token.generation !== generation || token.seq !== newest[token.channel],
    invalidate: () => {
      generation += 1;
    },
  };
}

export type ReadGuard = ReturnType<typeof createReadGuard>;

/** "Setup" only for a list known to be empty; an unread list is unknown, not empty. */
export function headerMode(configs: RunConfigurationView[] | undefined): "setup" | "run" {
  return configs?.length === 0 ? "setup" : "run";
}

/** The run pill's state: the configurations re-read on each open, and the status feed handed on to whoever reveals new terminals. */
export function useRunHeader({
  sessionId,
  hostId,
  api: injected,
  onTerminals,
}: {
  sessionId: string;
  hostId: string | undefined;
  api: RunApi | undefined;
  onTerminals: ((terminals: readonly RunView[]) => void) | undefined;
}) {
  // Pinned to one host: two hosts can hold the same session id.
  const api = useMemo(() => injected ?? createRunApi(hostFetcher(hostId ?? LOCAL_HOST_ID)), [injected, hostId]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configs, setConfigs] = useState<RunConfigurationView[]>();
  const [editing, setEditing] = useState<{ config?: RunConfigurationView } | undefined>();
  const [error, setError] = useState<string>();
  const [guard] = useState(createReadGuard);
  useEffect(() => () => guard.invalidate(), [guard]);

  const feed = useRunStatusFeed({ sessionId, ...(hostId ? { hostId } : {}), api });
  const report = useRef(onTerminals);
  useEffect(() => {
    report.current = onTerminals;
  });
  useEffect(() => {
    if (feed.status) report.current?.(feed.status.terminals ?? []);
  }, [feed.status]);

  const loadConfigs = useCallback(() => {
    const token = guard.open("configs");
    api
      .configurations(sessionId)
      .then((answer) => {
        if (!guard.stale(token)) setConfigs(answer.configurations);
      })
      .catch((cause: unknown) => {
        if (!guard.stale(token)) setError(cause instanceof Error ? cause.message : "Could not read the run configurations.");
      });
  }, [api, sessionId, guard]);
  // On mount too: the button must know whether any recipe exists before anyone presses it.
  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);
  useEffect(() => {
    if (open) loadConfigs();
  }, [open, loadConfigs]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      guard.invalidate();
      feed.refresh();
      loadConfigs();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "That run action failed.");
    } finally {
      setBusy(false);
    }
  };

  const save = (draft: RunConfigurationDraft | Partial<RunConfigurationDraft>) =>
    void run(async () => {
      if (editing?.config) await api.updateConfiguration(sessionId, editing.config.id, draft);
      else await api.createConfiguration(sessionId, draft as RunConfigurationDraft);
      setEditing(undefined);
    });

  // The engine types it into this configuration's idle shell, or opens a new one.
  const start = (configId: string) => void run(() => api.start(sessionId, configId));

  return { open, setOpen, busy, configs, editing, setEditing, error, save, start };
}

export type RunHeader = ReturnType<typeof useRunHeader>;
