"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { EngineHealth } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { markNavigation } from "@/platform/perf-marks";
import { SettingsGroup, SettingsShell } from "./settings-shell";
import { SettingsSkeleton } from "./settings-skeleton";
import { SECTION_IDS, SECTIONS } from "../settings-sections";
import { settingsSearchIndex } from "../registry";
import { projectPaneFor } from "@/features/plugins";
import { useSectionFromUrl } from "../use-section-from-url";
import { useSettingsReturnPath } from "../return-path";

const SectionSkeleton = () => <SettingsSkeleton />;

const ExperimentalRows = dynamic(() => import("./experimental-rows").then((mod) => mod.ExperimentalRows));
const AppearanceSection = dynamic(() => import("@/features/appearance/components/appearance-section").then((mod) => mod.AppearanceSection), { loading: SectionSkeleton });
const RailSection = dynamic(() => import("@/features/sessions/components/rail-section").then((mod) => mod.RailSection), { loading: SectionSkeleton });
const ContinueAfterRestartRow = dynamic(() => import("@/features/sessions/components/rail-section").then((mod) => mod.ContinueAfterRestartRow));
const DictationRows = dynamic(() => import("@/features/dictation/components/dictation-section").then((mod) => mod.DictationRows));
const SimulatorsRows = dynamic(() => import("@/features/simulators/components/simulators-section").then((mod) => mod.SimulatorsRows));
const OrientationRow = dynamic(() => import("@/features/agent-tools/components/orientation-section").then((mod) => mod.OrientationRow));
const BrowserGroup = dynamic(() => import("@/features/browser/panes/browser-group").then((mod) => mod.BrowserGroup), { loading: SectionSkeleton });
const KeybindingsPage = dynamic(() => import("@/features/commands/components/keybindings-page").then((mod) => mod.KeybindingsPage), { loading: SectionSkeleton });
const ProjectsPage = dynamic(() => import("@/features/projects/components/projects-page").then((mod) => mod.ProjectsPage), { loading: SectionSkeleton });
const ComputerUseRow = dynamic(() => import("@/features/providers/components/permissions-section").then((mod) => mod.ComputerUseRow));
const ProvidersSection = dynamic(() => import("@/features/providers/components/providers-section").then((mod) => mod.ProvidersSection), { loading: SectionSkeleton });
const RemoteSection = dynamic(() => import("@/features/remote/components/remote-section").then((mod) => mod.RemoteSection), { loading: SectionSkeleton });
const PushNotificationsGroup = dynamic(() => import("@/features/push").then((mod) => mod.PushNotificationsGroup), { loading: SectionSkeleton });
const SourceControlPage = dynamic(() => import("@/features/github/components/source-control-page").then((mod) => mod.SourceControlPage), { loading: SectionSkeleton });
const ComputerRows = dynamic(() => import("@/features/hosts/components/other-hosts").then((mod) => mod.ComputerRows), { loading: SectionSkeleton });
const TextGenSection = dynamic(() => import("@/features/providers/components/textgen-section").then((mod) => mod.TextGenSection), { loading: SectionSkeleton });
const PluginsPage = dynamic(() => import("@/features/plugins/components/plugins-page").then((mod) => mod.PluginsPage), { loading: SectionSkeleton });
const AboutSection = dynamic(() => import("@/features/updates/components/about-section").then((mod) => mod.AboutSection), { loading: SectionSkeleton });
const StoreSection = dynamic(() => import("@/features/storage/components/store-section").then((mod) => mod.StoreSection), { loading: SectionSkeleton });
const CleanupSection = dynamic(() => import("@/features/worktrees/components/cleanup-section").then((mod) => mod.CleanupSection), { loading: SectionSkeleton });
const UsageProvidersSection = dynamic(() => import("@/features/usage").then((mod) => mod.UsageProvidersSection), { loading: SectionSkeleton });
const WorkspaceSection = dynamic(() => import("@/features/projects/components/workspace-section").then((mod) => mod.WorkspaceSection), { loading: SectionSkeleton });

const api = createEngineApi();

export function SettingsPage() {
  const [active, setActive, revealRow] = useSectionFromUrl("general", SECTION_IDS);
  const backHref = useSettingsReturnPath();
  const [about, setAbout] = useState<{ appVersion: string }>();
  const [health, setHealth] = useState<EngineHealth>();

  const load = useCallback(async () => {
    void api
      .about()
      .then(setAbout)
      .catch(() => undefined);
    await api
      .health()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load().then(() => markNavigation("idle", window.location.pathname));
    }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const search = useMemo(
    () => settingsSearchIndex(health?.plugins, (scope, id) => scope === "project" && projectPaneFor(id) !== undefined),
    [health],
  );

  return (
    <SettingsShell
      title="Settings"
      sections={SECTIONS}
      active={active}
      onSelect={setActive}
      backHref={backHref}
      search={search}
      {...(revealRow ? { reveal: revealRow } : {})}
    >
      {active === "general" && (
        <Suspense fallback={<SettingsSkeleton />}>
          <WorkspaceSection>
            <ContinueAfterRestartRow />
          </WorkspaceSection>
          <RailSection />
          <TextGenSection />
          <AboutSection {...(about ? { appVersion: about.appVersion } : {})}>
            <ExperimentalRows />
          </AboutSection>
        </Suspense>
      )}

      {active === "appearance" && <AppearanceSection />}

      {active === "keybindings" && <KeybindingsPage />}

      {active === "providers" && (
        <>
          <ProvidersSection />
          <UsageProvidersSection />
        </>
      )}

      {active === "integrations" && (
        <Suspense fallback={<SettingsSkeleton />}>
          <BrowserGroup />
          <SettingsGroup title="Simulators">
            <SimulatorsRows />
          </SettingsGroup>
          <SettingsGroup title="Agent tools">
            <OrientationRow />
            <ComputerUseRow />
          </SettingsGroup>
          <SettingsGroup title="Voice" scope="mac">
            <DictationRows />
          </SettingsGroup>
        </Suspense>
      )}

      {active === "plugins" && <PluginsPage />}

      {active === "projects" && <ProjectsPage />}

      {active === "notifications" && <PushNotificationsGroup />}

      {active === "source-control" && <SourceControlPage />}

      {active === "storage" && (
        <>
          <CleanupSection />
          <StoreSection />
        </>
      )}

      {active === "connections" && (
        <RemoteSection>
          <ComputerRows />
        </RemoteSection>
      )}
    </SettingsShell>
  );
}
