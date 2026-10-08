"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderDriverKind, RuntimeMode } from "@telar/engine-client";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import { writeDraft, writeDraftFiles } from "@/features/composer";
import { sessionModelSelection, type ModelChoice } from "@telar/client/providers";
import { browserPanelTab, describeBrowserStart, latestBrowserState, LIVE_BROWSER_TAB, type BrowserStartState } from "@/features/panel";
import { desktopBrowserBridge } from "@/features/browser/desktop-browser-bridge";
import { nativePageToShow, openNativePage } from "@/features/browser/native-pages";
import { hostFetcher } from "@/platform/engine/host-client";
import { sessionHref } from "../../session-list";
import { newSessionId } from "../../session-mutations";
import { handOffCanvas } from "../canvas-handoff";
import type { useCockpitPanel } from "./use-cockpit-panel";
import type { useComposerDraft } from "./use-composer-draft";
import type { useSessionSync } from "./use-session-sync";

export type DraftChoices = {
  driver: ProviderDriverKind;
  envMode: "local" | "worktree";
  base: { baseRef?: string; branchName?: string };
  pick: ModelChoice;
  runtimeMode: RuntimeMode;
};

/** The session's browser: one entry that shows the last page when one runs, else starts it — which first turns a fresh canvas into a draft session. */
export function useSessionBrowser({ hostId, sessionId, projectId, sync, draft, composer, panel, setCreatedSessionId }: {
  hostId: string;
  sessionId: string | undefined;
  projectId: string | undefined;
  sync: ReturnType<typeof useSessionSync>;
  draft: DraftChoices;
  composer: ReturnType<typeof useComposerDraft>;
  panel: ReturnType<typeof useCockpitPanel>;
  setCreatedSessionId: (id: string) => void;
}) {
  const { transcriptLanded, events } = sync;
  /** Folded once here so the panel and the pinned summary cannot disagree about which tabs are open. */
  const browser = useMemo(() => latestBrowserState(events), [events]);

  const [browserCanStart, setBrowserCanStart] = useState<boolean>();
  useEffect(() => {
    if (!transcriptLanded) return;
    let cancelled = false;
    // Deferred: a synchronous setState in an effect body is a cascading render.
    const task = window.setTimeout(() => {
      setBrowserCanStart(undefined);
      if (!desktopBrowserBridge()) {
        setBrowserCanStart(false);
        return;
      }
      if (!sessionId) {
        setBrowserCanStart(Boolean(projectId));
        return;
      }
      createEngineApi(hostFetcher(hostId)).browserState(sessionId).then(
        (result) => {
          if (!cancelled) setBrowserCanStart(result.browser.canStart ?? false);
        },
        () => undefined,
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, [sessionId, projectId, hostId, transcriptLanded]);

  const [browserStart, setBrowserStart] = useState<BrowserStartState>({ status: "idle" });
  const browserOpening = useRef(false);
  const browserDraftIdentity = useRef<{ path: string; id: string } | null>(null);
  const browserDraftFlight = useRef<Promise<string> | null>(null);
  const browserDraftSendPending = useRef(false);

  async function ensureBrowserDraft(): Promise<string> {
    if (sessionId) return sessionId;
    if (projectId === undefined) throw new EngineApiError("invalid_request", "This session has no project to open a draft in.");
    if (browserDraftFlight.current) return browserDraftFlight.current;
    const origin = window.location.pathname;
    if (browserDraftIdentity.current?.path !== origin) browserDraftIdentity.current = { path: origin, id: newSessionId() };
    const id = browserDraftIdentity.current.id;
    // Keep both requests on the originating host if navigation changes mid-flight.
    const draftApi = createEngineApi(hostFetcher(hostId));
    const flight = (async () => {
      const created = await draftApi.createSession(projectId, {
        id, draft: true, title: "Browser draft", driver: draft.driver, envMode: draft.envMode,
        ...(draft.envMode === "worktree" ? draft.base : {}),
      });
      const model = sessionModelSelection(created.session.providerInstanceId, draft.pick);
      const patched = await draftApi.updateSession(id, { runtimeMode: draft.runtimeMode, ...(model ? { model } : {}) });
      // Keep the durable draft, but never navigate over a different conversation.
      if (window.location.pathname !== origin) return id;
      writeDraft(id, projectId, composer.draftText.current);
      writeDraft(undefined, projectId, "");
      writeDraftFiles(id, projectId, composer.draftFiles.current);
      writeDraftFiles(undefined, projectId, []);
      handOffCanvas(id, projectId, panel);
      composer.claim({ sessionId: id, projectId });
      sync.setSession(patched.session);
      setCreatedSessionId(id);
      const destination = sessionHref({ id, projectId, hostId });
      browserDraftIdentity.current = { path: destination, id };
      window.history.replaceState(null, "", destination);
      return id;
    })();
    browserDraftFlight.current = flight;
    try { return await flight; } finally { browserDraftFlight.current = null; }
  }

  // In the desktop app the native browser's own pages are the truth; the journal lags them.
  async function showBrowser(target: string | undefined, journalled: readonly { id: string; active?: boolean }[]): Promise<boolean> {
    const bridge = desktopBrowserBridge();
    const page = bridge ? (target ? await nativePageToShow(bridge, target) : undefined) : (journalled.find((tab) => tab.active) ?? journalled.at(-1))?.id;
    if (!page) return false;
    panel.showPanelTab(bridge ? panel.pageTab(page) : browserPanelTab(page));
    return true;
  }

  async function openGroupedPage(): Promise<boolean> {
    const bridge = desktopBrowserBridge();
    if (panel.flat || !bridge || !sessionId) return false;
    const opened = await openNativePage(bridge, sessionId).catch(() => undefined);
    if (opened) panel.showPanelTab(LIVE_BROWSER_TAB);
    return opened !== undefined;
  }

  async function openBrowser() {
    const bridge = desktopBrowserBridge();
    if (!panel.flat && bridge) {
      if (await openGroupedPage()) return;
    } else {
      const opened = bridge && sessionId ? await openNativePage(bridge, sessionId).catch(() => undefined) : undefined;
      if (opened) return panel.showPanelTab(browserPanelTab(opened));
      if (!bridge && (await showBrowser(sessionId, browser?.tabs ?? []))) return;
    }
    if (browserOpening.current) return;
    browserOpening.current = true;
    const origin = window.location.pathname;
    setBrowserStart({ status: "pending" });
    let destination = origin;
    const browserApi = createEngineApi(hostFetcher(hostId));
    try {
      const target = await ensureBrowserDraft();
      destination = sessionHref({ id: target, projectId, hostId });
      if (window.location.pathname !== origin && window.location.pathname !== destination) return;
      // Bind the native host before the engine asks it to create the first tab.
      await desktopBrowserBridge()?.bindProfile?.(target, projectId ?? "none");
      if (window.location.pathname !== origin && window.location.pathname !== destination) return;
      const result = await browserApi.browserState(target, { start: true });
      if (window.location.pathname !== destination) return;
      setBrowserStart(describeBrowserStart(result.browser));
      await showBrowser(target, result.browser.tabs);
    } catch (error) {
      if (window.location.pathname === origin || window.location.pathname === destination) {
        setBrowserStart({ status: "error", message: error instanceof Error ? error.message : "The engine could not start a browser." });
      }
    } finally {
      browserOpening.current = false;
    }
  }

  const pages = browser?.tabs.length ?? 0;
  const browserUnavailable =
    pages > 0 || browserCanStart !== false ? undefined : desktopBrowserBridge() ? "This session can't start a browser" : "Starting a browser needs the desktop app";
  return { browser, browserUnavailable, browserStart, openBrowser, browserDraftFlight, browserDraftSendPending };
}
