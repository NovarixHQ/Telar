"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ConversationFollowHandle } from "@/ui/conversation";
import { Composer } from "@/features/composer";
import { canvasPanelKey, RailToggle, RightPanel } from "@/features/panel";
import { usePluginPanels } from "@/features/plugins";
import { useProviderInstance } from "@/features/providers";
import { SessionSchedules } from "@/features/schedules";
import { floatKey, useSimulatorFloat } from "@/features/simulators";
import { normaliseContextNoticePercent } from "@/features/composer/context-notice";
import { hostFromPathname } from "@/platform/engine/host-client";
import { canvasHref } from "../../session-list";
import { pinToggleOverride, showSimulatorTab } from "../model";
import { useCockpitCommands } from "../hooks/use-cockpit-commands";
import { useCockpitPanel } from "../hooks/use-cockpit-panel";
import { useCockpitProject } from "../hooks/use-cockpit-project";
import { useComposerDraft } from "../hooks/use-composer-draft";
import { useDraftConfig } from "../hooks/use-draft-config";
import { useJournalReactions } from "../hooks/use-journal-reactions";
import { useLinkRouting } from "../hooks/use-link-routing";
import { useNavigationMarks } from "../hooks/use-navigation-marks";
import { useSessionActions } from "../hooks/use-session-actions";
import { useSessionBrowser } from "../hooks/use-session-browser";
import { useBuildersBanner } from "../hooks/use-builders-banner";
import { childrenGrowth, useSessionChildren } from "../hooks/use-session-children";
import { useSessionSync } from "../hooks/use-session-sync";
import { useSettling } from "../hooks/use-settling";
import { useSubmit } from "../hooks/use-submit";
import { useTitleMenu } from "../hooks/use-title-menu";
import { useTranscriptModel } from "../hooks/use-transcript-model";
import { pendingStillShown, type PendingTurn } from "../pending-turn";
import { composerProps } from "./composer-props";
import { rightPanelProps } from "./right-panel-props";
import { SessionMasthead, SoloTools, usePanelPresence } from "./masthead";
import { WorkspaceCard } from "./workspace-card";
import { WorkspaceCardToggle } from "./workspace-card-toggle";
import { useReadReceipt } from "./read-receipt";
import { useRememberedRow } from "../hooks/use-remembered-row";
import { TranscriptList } from "./transcript-list";

const FloatingSimulator = dynamic(() => import("@/features/simulators/components/floating-simulator").then((mod) => mod.FloatingSimulator));

export function SessionCockpit({
  projectId,
  sessionId: routeSessionId,
  projectName: serverProjectName,
  solo = false,
}: {
  projectId?: string;
  sessionId?: string;
  /** Resolved by the page, so the breadcrumb and the greeting never paint the raw id first. */
  projectName?: string;
  solo?: boolean;
}) {
  const [createdSessionId, setCreatedSessionId] = useState<string>();
  const [pending, setPending] = useState<PendingTurn>();
  const pathname = usePathname();
  const hostId = hostFromPathname(pathname);
  // A session with no project has no canvas URL, so it is never on the canvas.
  const onCanvas = projectId !== undefined && pathname === canvasHref(projectId, hostId);
  const sessionId = routeSessionId ?? (onCanvas ? undefined : createdSessionId);
  /** No session yet: the composer is the whole screen and nothing is polled. */
  const fresh = !sessionId && !pending;
  const sync = useSessionSync({ hostId, sessionId, initiallyLoading: Boolean(routeSessionId) });
  if (pending && !pendingStillShown(pending, sessionId, sync.turns)) setPending(undefined);
  const { session, turns, transcriptLanded } = sync;
  const remembered = useRememberedRow(hostId, session ? undefined : sessionId);
  const { projectName, projectResolved, defaults: projectDefaults, enabledPlugins } = useCockpitProject({
    hostId, projectId, serverProjectName, transcriptLanded,
  });
  const draftConfig = useDraftConfig({ projectId, fresh, projectDefaults });
  const composer = useComposerDraft({ sessionId, projectId });
  const follow = useRef<ConversationFollowHandle>(null);
  /** Reading back through the transcript steps the composer down to its compact shape. */
  const [readingBack, setReadingBack] = useState(false);
  const onAtBottomChange = useCallback((atBottom: boolean) => setReadingBack(!atBottom), []);
  const pluginPanels = usePluginPanels(hostId, enabledPlugins);
  const panelKey = sessionId ?? (projectId === undefined ? "main" : canvasPanelKey(projectId));
  const panelState = useCockpitPanel({ panelKey, enabledPlugins, hostId, sessionId });
  const { panel, showPanelTab } = panelState;
  const panelPresence = usePanelPresence(!solo && panel.open);
  const browser = useSessionBrowser({ hostId, sessionId, projectId, sync, draft: draftConfig, composer, panel: panelState, setCreatedSessionId });
  useCockpitCommands({
    solo, enabledPlugins, panel: panelState, openBrowser: () => void browser.openBrowser(),
    pinSession: () => {
      if (!sessionId) return;
      void settling.patchFromMenu({ settledOverride: pinToggleOverride(session?.settledOverride) }, "Could not change the session's pin.");
    },
  });
  const onConversationClick = useLinkRouting({ hostId, projectId, sessionId, solo, panel: panelState });
  const revealNewTerminals = useJournalReactions({ sessionId, sync, browser: browser.browser, enabledPlugins, panel: panelState });
  const model = useTranscriptModel(sessionId, sync, pending);
  const { active } = model;
  const agents = useSessionChildren(hostId, sessionId, childrenGrowth(model.transcript));
  const builders = useBuildersBanner(hostId, agents);
  const settling = useSettling(hostId, sessionId, sync);
  const actions = useSessionActions(sessionId, sync);
  const submit = useSubmit({
    hostId, sessionId, projectId, busy: Boolean(active), sync, composer, draft: draftConfig, browser, panel: panelState, actions, follow, setCreatedSessionId, setPending,
  });
  const headerMenu = useTitleMenu({ hostId, projectId, projectName, sessionId, sync, settling });
  useNavigationMarks(pathname, transcriptLanded, sync.loading);
  const receipt = useReadReceipt(hostId, sessionId, sync);
  const providerInstance = useProviderInstance(session?.providerInstanceId, session?.driver);
  const floating = useSimulatorFloat(sessionId && !solo ? floatKey(hostId, sessionId) : undefined).simulator;
  const panelGestures = solo
    ? {}
    : { onOpenTab: showPanelTab, onOpenFile: (path: string) => showPanelTab(`file:${path}`), onOpenFileInNewTab: panelState.openFileInNewPanelTab };

  return (
    <main data-surfaces className="group/surfaces flex min-h-0 flex-1 overflow-hidden md:overflow-visible md:gap-2">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:rounded-xl md:bg-sidebar md:shadow-1 md:ring-1 md:ring-sidebar-border md:group-has-[[data-panel-fullscreen]]/surfaces:shadow-none md:group-has-[[data-panel-fullscreen]]/surfaces:ring-0">
        {solo ? (
          <SoloTools hostId={hostId} session={session} />
        ) : (
          <SessionMasthead
            projectId={projectId}
            hostId={hostId}
            projectName={projectName ?? remembered?.projectName}
            projectResolved={projectResolved}
            session={session}
            fallbackTitle={fresh ? "New session" : remembered?.title}
            {...(headerMenu ? { menu: headerMenu } : {})}
            onRename={(next) => void actions.rename(next)}
            panel={
              <>
                {session && <WorkspaceCardToggle />}
                {/* Keyed by host and session: a different machine is a different mount. The last turn's state is the refresh cue. */}
                {session && (
                  <SessionSchedules key={`${hostId}:${session.id}`} sessionId={session.id} hostId={hostId} refreshKey={`${turns.at(-1)?.runId}:${turns.at(-1)?.state}`} />
                )}
                <RailToggle open={panel.open} onToggle={panelState.togglePanel} />
              </>
            }
          />
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            {!solo && session && (
              <WorkspaceCard
                key={`${hostId}:${session.id}`} hostId={hostId} session={session} agents={agents} busy={Boolean(active)}
                backgroundTasks={model.backgroundTasks} panel={panelState} dismissible={panel.open} onRunTerminals={revealNewTerminals}
              />
            )}
            <TranscriptList
              sync={sync}
              model={model}
              receipt={receipt}
              follow={follow}
              onAtBottomChange={onAtBottomChange}
              onConversationClick={onConversationClick}
              projectId={projectId}
              hostId={hostId}
              fresh={fresh}
              agents={agents}
              turn={{
                roster: model.roster,
                sending: actions.sending,
                onInsert: composer.insertIntoComposer,
                ...panelGestures,
                onDecide: (requestId, decision, extra) => void actions.decideRequest(requestId, decision, extra),
              }}
              onResumeNow={(runId) => void actions.resumeNow(runId)}
            />
          </div>
          <Composer
            {...composerProps({
              fresh, solo, session, projectId, projectName, composer, draft: draftConfig, actions, settling, model, submit,
              // Not while a conversation is opening: a composer changing height would move the viewport again.
              compact: readingBack && transcriptLanded,
              contextNoticePercent: normaliseContextNoticePercent(providerInstance?.contextNoticePercent),
              builders,
            })}
          />
          {floating && sessionId && (
            <Suspense fallback={null}>
              <FloatingSimulator sessionId={sessionId} hostId={hostId} onOpenInPanel={(id) => panelState.updatePanel((current) => showSimulatorTab(current, id))} />
            </Suspense>
          )}
        </div>
      </div>
      {panelPresence.mounted && (
        <RightPanel
          {...rightPanelProps({
            open: panelPresence.shown, hostId, sessionId, projectId, sync, model, panel: panelState, browser, composer, enabledPlugins, pluginPanels,
          })}
        />
      )}
    </main>
  );
}
