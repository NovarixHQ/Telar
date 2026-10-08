import type { ClaudeConversation, EngineRequest, ProviderDriverKind, RuntimeMode, Session, SessionChildState, UsageSnapshot } from "@telar/engine-client";
import type { ModelChoice } from "@/features/providers";
import type { ComposerKind } from "../registry";

export type ComposerProps = {
  draft: string;
  ready: boolean;
  /** Scrolled back through the transcript: one line, pills in a tray. Anything that needs the full box keeps it. */
  compact?: boolean;
  /** Names the editable root and is what the page API reports. */
  kind?: ComposerKind;
  /** Picked files not yet sent; the cockpit owns them because it uploads them with the submit. */
  attachments: File[];
  /** Takes the whole new list. */
  onAttach: (files: File[]) => void;
  /** No session yet: the composer fills the screen and the pills choose what the first message creates. */
  fresh?: boolean;
  driver?: ProviderDriverKind;
  onDriverChange?: (driver: ProviderDriverKind) => void;
  envMode?: "local" | "worktree";
  onEnvMode?: (mode: "local" | "worktree") => void;
  pendingBase?: { baseRef?: string; branchName?: string };
  onBase?: (next: { baseRef?: string; branchName?: string }) => void;
  /** Offered by `/resume` on a fresh canvas; the caller creates the session that receives the conversation. */
  onAdopt?: (conversation: ClaudeConversation) => Promise<void>;
  /** What the first message will create the session with, while fresh. */
  pendingModel?: ModelChoice;
  /** A turn is running or claimed. Not a reason to disable anything: Enter steers it. */
  busy: boolean;
  sending: boolean;
  runtimeMode?: RuntimeMode;
  session?: Session;
  /** Absent means a project-less conversation: no environment strip, greeting or `@` file listing. */
  projectId?: string;
  projectName?: string;
  usage?: UsageSnapshot;
  backgroundTasks: number;
  settled?: boolean;
  /** What settling just ended, said once on the banner. */
  settledEnded?: string;
  onUnsettle?: () => void;
  /** The countdown label, present only while a snooze is live. */
  snoozeWakeIn?: string;
  onWake?: () => void;
  /** This session's builders by state, while any is still out, and the brake for all of them. */
  builders?: { counts: Partial<Record<SessionChildState, number>>; stopping: boolean; onStopAll: () => void };
  /** Submits a `/compact` turn; passed on Claude sessions only. */
  onCompact?: () => void;
  /** While present, the editor is the question's custom answer and Enter advances or answers. */
  question?: EngineRequest;
  onAnswerQuestion?: (requestId: string, answers: Record<string, string | string[]>) => void;
  onCancelQuestion?: (requestId: string) => void;
  compacting?: boolean;
  /** This login's heavy-context threshold, as a whole percentage. */
  contextNoticePercent?: number;
  sentPrompts?: readonly string[];
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  /** Stops the lingering background tasks; `onStop` ends the turn and spares them. */
  onStopBackground: () => void;
  onRuntimeMode: (mode: RuntimeMode) => void;
  /** Takes the whole next choice. Absent makes every picker read-only. */
  onModelChange?: (next: ModelChoice) => void;
  onSwitchProvider?: (driver: ProviderDriverKind, next: ModelChoice) => void;
};
