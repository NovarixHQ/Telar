import { z } from "zod";
import { Id, ProviderDriverKind, Timestamp } from "../protocol/common";
import type { SessionAssignment } from "../protocol/assignments";
import type { EngineEvent } from "../protocol/events";
import type { LiveSessionRow, Project, Session, Subscription, Turn } from "../protocol/entities";
import type { Item } from "../protocol/items";
import type { EngineRequest } from "../protocol/requests";
import type { Task } from "../protocol/tasks";
import type { Effort, EnvMode, RuntimeMode } from "../protocol/common";
import type { InboxPolicy, SidebarLayout } from "../settings/schema";

export type SessionSettleEnded = { terminals: number; backgroundTasks: number };

export const SessionChildState = z.enum(["working", "waiting", "done", "failed", "stopped"]);
export type SessionChildState = z.infer<typeof SessionChildState>;

/** A session another session tasked, as its parent sees it: `GET /v2/sessions/:id/children`. */
export const SessionChild = z.object({
  sessionId: Id,
  parentSessionId: Id,
  parentRunId: Id.optional(),
  title: z.string().max(200).optional(),
  provider: ProviderDriverKind.optional(),
  model: z.string().optional(),
  state: SessionChildState,
  /** What a working child is doing now, one line. */
  progress: z.string().max(120).optional(),
  blocked: z.boolean().optional(),
  summary: z.string().max(200).optional(),
  /** Where its result, or the run that ended it, is read. */
  fetch: z.object({ sessionId: Id, runId: Id }).optional(),
  startedAt: Timestamp,
  endedAt: Timestamp.optional(),
  updatedAt: Timestamp.optional(),
});
export type SessionChild =z.infer<typeof SessionChild>;

export type SessionChildren = { children: SessionChild[] };

/** The cockpit's route to a session, relative to its host; a session without a project lives on the main page. */
export function cockpitSessionHref(session: { id: string; projectId?: string | undefined }): string {
  return session.projectId ? `/projects/${encodeURIComponent(session.projectId)}/sessions/${encodeURIComponent(session.id)}` : "/main";
}

export type SnapshotPage = {
  /** Oldest settled turn on this page: the `before` for the next page up. */
  before: string | null;
  more: boolean;
  total?: number;
};

/** How much of a session to read. Omit for the whole thing. */
export type SnapshotWindow = {
  /** Newest N settled turns; unsettled ones always ride along. */
  turns: number;
  before?: string;
};

export function snapshotQuery(window?: SnapshotWindow): string {
  if (!window) return "";
  const params = new URLSearchParams({ turns: String(window.turns) });
  if (window.before !== undefined) params.set("before", window.before);
  return `?${params.toString()}`;
}

export type SessionSnapshot = {
  cursor?: number;
  page?: SnapshotPage;
  session: Session;
  turns: Turn[];
  items: Item[];
  requests: EngineRequest[];
  assignments?: SessionAssignment[];
  tasks: Task[];
};

/** A client's own cursor after applying `events` is `max(cursor, last event id)`. */
export type SessionBootstrap = SessionSnapshot & { events: EngineEvent[]; subscriptions: Subscription[] };

export type SessionDelta = { reset: true } | { reset: false; events: EngineEvent[]; cursor: number };

export type HeldReports = { held: number };

export type SessionSearchHit = {
  id: string;
  title?: string;
  projectId?: string;
  activity: string;
  updatedAt: number;
  runId?: string;
  /** The matching line, clamped. */
  why: string;
};

export type SessionSearchAnswer = { sessions: SessionSearchHit[]; index: "fts5" | "like"; more: boolean };

export type SessionOutlineRow = {
  runId: string;
  sequence: number;
  origin?: Turn["origin"];
  state: Turn["state"];
  input: string;
  items: number;
  answer: string;
  answerChars: number;
  endedAt?: number;
  failure?: string;
};

export type SessionOutlineAnswer = { turns: SessionOutlineRow[]; total: number; more: boolean; next?: number };

export type SessionGrepMatch = {
  /** Also the `before` cursor for the next page. */
  id: number;
  at: number;
  type: string;
  runId?: string;
  context: string;
};

export type SessionGrepAnswer = { matches: SessionGrepMatch[]; more: boolean; next?: number };

export type LiveSessionsAnswer = {
  sessions: LiveSessionRow[];
  projects: Project[];
  assignments?: Record<string, SessionAssignment[]>;
  layout?: SidebarLayout;
  daemonId?: string;
  inbox?: InboxPolicy;
  revision?: number;
  settledCount?: number;
  settledByProject?: Record<string, number>;
  terminals?: Record<string, number>;
  /** Never sent; present so `unchanged` narrows the union without a cast. */
  unchanged?: false;
};

export type LiveSessionsUnchanged = { unchanged: true; revision: number; daemonId?: string };

export type CapabilityModel = {
  id: string;
  label: string;
  tier?: number;
  efforts: Effort[];
  defaultEffort?: Effort;
  window?: number;
  default?: true;
};

export type SessionCapabilities = {
  you?: { sessionId: string; driver: ProviderDriverKind; instanceId: string; model?: string; effort?: Effort; tier?: number; access: RuntimeMode };
  defaults: { envMode: EnvMode; access?: RuntimeMode; project?: { model?: string; effort?: Effort } };
  providers: Array<{ instanceId: string; driver: ProviderDriverKind; name?: string; models: CapabilityModel[] }>;
};
