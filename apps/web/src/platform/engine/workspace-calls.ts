import type {
AgentCatalog,
BrowserSnapshot,
ClaudeConversation,
ConversationImportDetail,ProviderDriverKind,
ProviderSkills,
ProviderInstance,
ProviderInstanceEnvVar,
AutoCompact,
ProviderProbe,Session,Turn,UsageLimitWindow,WorkspaceFile,
WorkspaceListing,
WorkspaceWriteResult
} from "@telar/engine-client";
import type { Fetcher } from "./host-client";
import { request } from "./transport";

/** The cockpit's own workspace calls: the ones no package domain client covers yet. */
export function workspaceCalls(fetcher: Fetcher) {
  return {
    projectFiles: (projectId: string) =>
      request<{ listing: WorkspaceListing }>(fetcher, "GET", `/api/projects/${encodeURIComponent(projectId)}/files`),
    sessionFiles: (sessionId: string) =>
      request<{ listing: WorkspaceListing }>(fetcher, "GET", `/api/sessions/${encodeURIComponent(sessionId)}/files`),
    /**
     * The provider's own skills and slash commands, for the composer's `$` and
     * `/` menus. Asked when a menu first opens and cached by the caller for the
     * session, the way the path listing is — the engine caches it too, so the
     * cost of asking twice is a round trip rather than a subprocess.
     */
    sessionSkills: (sessionId: string) =>
      request<ProviderSkills>(fetcher, "GET", `/api/sessions/${encodeURIComponent(sessionId)}/skills`),
    claudeConversations: (instanceId?: string) =>
      request<{ conversations: ClaudeConversation[] }>(
        fetcher,
        "GET",
        `/api/claude-conversations${instanceId ? `?${new URLSearchParams({ instanceId }).toString()}` : ""}`,
      ),
    /** Adopt one: fork it, import its history, and point this session's next
     *  turn at the fork. The person's own conversation is not written to. */
    adoptClaudeConversation: (sessionId: string, sourceSessionId: string) =>
      request<{ session: Session; turn: Turn; provenance: ConversationImportDetail }>(
        fetcher,
        "POST",
        `/api/sessions/${encodeURIComponent(sessionId)}/adopt`,
        { sourceSessionId },
      ),
    /**
     * The same, one scope wider — what a CANVAS asks, because the session that
     * would answer for itself does not exist yet (#500). `driver` is the
     * canvas's pending choice; absent means the engine's default.
     */
    projectSkills: (projectId: string, driver?: ProviderDriverKind) =>
      request<ProviderSkills>(
        fetcher,
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/skills${driver ? `?${new URLSearchParams({ driver }).toString()}` : ""}`,
      ),
    projectFile: (projectId: string, path: string) =>
      request<{ file: WorkspaceFile }>(
        fetcher,
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/files?${new URLSearchParams({ path }).toString()}`,
      ),
    sessionFile: (sessionId: string, path: string) =>
      request<{ file: WorkspaceFile }>(
        fetcher,
        "GET",
        `/api/sessions/${encodeURIComponent(sessionId)}/files?${new URLSearchParams({ path }).toString()}`,
      ),
    writeProjectFile: (projectId: string, path: string, text: string, expectedSha256: string) =>
      request<WorkspaceWriteResult>(
        fetcher,
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/files?${new URLSearchParams({ path }).toString()}`,
        { text, expectedSha256 },
      ),
    writeSessionFile: (sessionId: string, path: string, text: string, expectedSha256: string) =>
      request<WorkspaceWriteResult>(
        fetcher,
        "PUT",
        `/api/sessions/${encodeURIComponent(sessionId)}/files?${new URLSearchParams({ path }).toString()}`,
        { text, expectedSha256 },
      ),
  };
}

export function integrationCalls(fetcher: Fetcher) {
  return {
    /** What the session's browser is looking at. `screenshot` costs a round trip
     *  through Chromium and `start` would LAUNCH one, so both are opt-in. */
    browserState: (sessionId: string, options: { screenshot?: boolean; start?: boolean } = {}) => {
      const query = new URLSearchParams();
      if (options.screenshot) query.set("screenshot", "1");
      if (options.start) query.set("start", "1");
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<{ browser: BrowserSnapshot }>(fetcher, "GET", `/api/sessions/${encodeURIComponent(sessionId)}/browser${suffix}`);
    },
    /** Open a page in the session's browser as the human — the engine's door,
     *  for a client with no native shell (a remote cockpit, a phone). */
    browserOpen: (sessionId: string, url: string) =>
      request<{ browser: BrowserSnapshot }>(fetcher, "POST", `/api/sessions/${encodeURIComponent(sessionId)}/browser/open`, { url }),
    providerInstances: (options: { refresh?: boolean } = {}) =>
      request<{ providerInstances: ProviderInstance[]; probes: ProviderProbe[] }>(
        fetcher,
        "GET",
        `/api/provider-instances${options.refresh ? "?refresh=1" : ""}`,
      ),
    saveProviderInstance: (input: {
      id: string;
      driver?: ProviderDriverKind;
      displayName?: string | null;
      accentColor?: string | null;
      /** A whole percentage of the model's window; `null` returns this login to
       *  the cockpit's default. */
      contextNoticePercent?: number | null;
      autoCompact?: AutoCompact | null;
      configDir?: string | null;
      binaryPath?: string | null;
      extraArgs?: string | null;
      enabled?: boolean;
      env?: ProviderInstanceEnvVar[];
      /** Inherited variables to keep, by name. The engine supplies the values
       *  from its own environment; none crosses this call. */
      carryOverInherited?: string[];
    }) =>
      request<{ providerInstance: ProviderInstance; stoppedInheriting?: string[] }>(
        fetcher,
        "PUT",
        "/api/provider-instances",
        input,
      ),
    agentCatalog: (options: { refresh?: boolean } = {}) => request<AgentCatalog>(fetcher, "GET", `/api/agent-catalog${options.refresh ? "?refresh=1" : ""}`),
    installAgent: (agentId: string) =>
      request<{ providerInstance: ProviderInstance }>(fetcher, "POST", `/api/agent-catalog/${encodeURIComponent(agentId)}/install`, {}),
    providerLimits: (instanceId: string) =>
      request<{ windows: UsageLimitWindow[] }>(fetcher, "GET", `/api/provider-instances/${encodeURIComponent(instanceId)}/limits`),
  };
}
