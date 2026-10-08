"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { EngineHealth } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { markNavigation } from "@/platform/perf-marks";
import { SettingsShell } from "./settings-shell";
import { SECTION_IDS, SECTIONS } from "../settings-sections";
import { settingsSearchIndex } from "../registry";
import { projectPaneFor } from "@/features/plugins";
import { useSectionFromUrl } from "../use-section-from-url";
import { useSettingsReturnPath } from "../return-path";

const ExperimentalSection = dynamic(() => import("./experimental-section").then((mod) => mod.ExperimentalSection));
const AppearanceSection = dynamic(() => import("@/features/appearance/components/appearance-section").then((mod) => mod.AppearanceSection));
const OrganizationSection = dynamic(() => import("@/features/sessions/components/organization-section").then((mod) => mod.OrganizationSection));
const SettledTerminalsSection = dynamic(() => import("@/features/sessions/components/settled-terminals-section").then((mod) => mod.SettledTerminalsSection));
const LinksSection = dynamic(() => import("./links-section").then((mod) => mod.LinksSection));
const DictationSection = dynamic(() => import("@/features/dictation/components/dictation-section").then((mod) => mod.DictationSection));
const McpSection = dynamic(() => import("@/features/agent-tools/components/mcp-section").then((mod) => mod.McpSection));
const SimulatorsSection = dynamic(() => import("@/features/simulators/components/simulators-section").then((mod) => mod.SimulatorsSection));
const OrientationSection = dynamic(() => import("@/features/agent-tools/components/orientation-section").then((mod) => mod.OrientationSection));
const IntegrationsPage = dynamic(() => import("@/features/browser/panes/integrations-page").then((mod) => mod.IntegrationsPage));
const KeybindingsPage = dynamic(() => import("@/features/commands/components/keybindings-page").then((mod) => mod.KeybindingsPage));
const ProjectsPage = dynamic(() => import("@/features/projects/components/projects-page").then((mod) => mod.ProjectsPage));
const PermissionsSection = dynamic(() => import("@/features/providers/components/permissions-section").then((mod) => mod.PermissionsSection));
const ProvidersSection = dynamic(() => import("@/features/providers/components/providers-section").then((mod) => mod.ProvidersSection));
const RemoteSection = dynamic(() => import("@/features/remote/components/remote-section").then((mod) => mod.RemoteSection));
const PushNotificationsGroup = dynamic(() => import("@/features/push").then((mod) => mod.PushNotificationsGroup));
const SourceControlPage = dynamic(() => import("@/features/github/components/source-control-page").then((mod) => mod.SourceControlPage));
const OtherHostsSection = dynamic(() => import("@/features/hosts/components/other-hosts-section").then((mod) => mod.OtherHostsSection));
const TextGenSection = dynamic(() => import("@/features/providers/components/textgen-section").then((mod) => mod.TextGenSection));
const PluginsPage = dynamic(() => import("@/features/plugins/components/plugins-page").then((mod) => mod.PluginsPage));
const AboutSection = dynamic(() => import("@/features/updates/components/about-section").then((mod) => mod.AboutSection));
const StoreSection = dynamic(() => import("@/features/storage/components/store-section").then((mod) => mod.StoreSection));
const CleanupSection = dynamic(() => import("@/features/worktrees/components/cleanup-section").then((mod) => mod.CleanupSection));
const UsageProvidersSection = dynamic(() => import("@/features/usage").then((mod) => mod.UsageProvidersSection));
const WorkspaceSection = dynamic(() => import("@/features/projects/components/workspace-section").then((mod) => mod.WorkspaceSection));

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
      <Suspense fallback={null}>
        {active === "general" && (
          <>
            <WorkspaceSection />
            <OrganizationSection />
            <TextGenSection />
            <AboutSection {...(about ? { appVersion: about.appVersion } : {})} />
            <ExperimentalSection />
          </>
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
          <>
            <IntegrationsPage />
            <LinksSection />
            <SimulatorsSection />
            <OrientationSection />
            <McpSection />
            <PermissionsSection />
            <DictationSection />
          </>
        )}

        {active === "plugins" && <PluginsPage />}

        {active === "projects" && <ProjectsPage />}

        {active === "notifications" && <PushNotificationsGroup />}

        {active === "source-control" && <SourceControlPage />}

        {active === "storage" && (
          <>
            <CleanupSection />
            <SettledTerminalsSection />
            <StoreSection />
          </>
        )}

        {active === "connections" && (
          <>
            <RemoteSection />
            <OtherHostsSection />
          </>
        )}
      </Suspense>
    </SettingsShell>
  );
}
