"use client";

import { useCallback, useEffect, useState } from "react";
import { parsePluginPanelView, type PluginPanelView } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import type { PluginBlockCall } from "../components/panel-blocks";

const api = createEngineApi();

/** Where a view's verbs are answered: a session, a project, or this Mac. */
export type PluginViewScope = { sessionId: string } | { projectId: string } | Record<string, never>;

type ViewState = { status: "loading" } | { status: "ready"; view: PluginPanelView } | { status: "failed"; error: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function send(scope: PluginViewScope, plugin: string, method: "GET" | "POST", verb: string, input: Record<string, unknown> = {}) {
  if ("sessionId" in scope) return api.sessionPluginVerb(scope.sessionId, plugin, verb, input);
  return api.scopedPluginRoute("projectId" in scope ? { projectId: scope.projectId } : {}, plugin, method, verb, input);
}

/** Reads `verb` as blocks, redraws on `refreshKey` and while the view asks to be polled, and runs its actions; a refused action is `failure`. */
export function usePluginView(scope: PluginViewScope | undefined, plugin: string, verb: string, refreshKey?: unknown) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [pending, setPending] = useState<number>();
  const [failure, setFailure] = useState<string>();
  const key = scope ? JSON.stringify(scope) : undefined;

  const read = useCallback(async () => {
    if (!key) return;
    try {
      setState({ status: "ready", view: parsePluginPanelView(await send(JSON.parse(key) as PluginViewScope, plugin, "GET", verb)) });
    } catch (error) {
      setState({ status: "failed", error: message(error) });
    }
  }, [key, plugin, verb]);

  useEffect(() => {
    const task = window.setTimeout(() => void read(), 0);
    return () => window.clearTimeout(task);
  }, [read, refreshKey]);

  const refreshMs = state.status === "ready" ? state.view.refreshMs : undefined;
  useEffect(() => {
    if (!refreshMs) return;
    const timer = window.setTimeout(() => void read(), refreshMs);
    return () => window.clearTimeout(timer);
  }, [read, refreshMs, state]);

  const call = useCallback(
    async (target: PluginBlockCall, index: number) => {
      if (!key) return;
      setPending(index);
      setFailure(undefined);
      try {
        await send(JSON.parse(key) as PluginViewScope, plugin, "POST", target.verb, target.input ?? {});
        await read();
      } catch (error) {
        setFailure(message(error));
        await read();
      } finally {
        setPending(undefined);
      }
    },
    [key, plugin, read],
  );

  return { state, pending, failure, read, call };
}
