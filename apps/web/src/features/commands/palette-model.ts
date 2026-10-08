import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@telar/engine-client";
import { type NewConversationTarget, matchTargets } from "@/features/projects";
import type { SettingsSearchEntry } from "@/features/settings";
import type { Command, CommandId, Keymap } from "./commands";

export const RECENT_CONVERSATION_LIMIT = 8;

export type PaletteSubPage = "projects" | "sources";

export const PALETTE_SUB_PAGES: Partial<Record<CommandId, PaletteSubPage>> = {
  "new-conversation-in": "projects",
  "add-project": "sources",
};

export type PaletteQuickPage = "accent";

export const PALETTE_QUICK_COMMANDS: readonly CommandId[] = ["toggle-rail"];

export type QuickSettingId =
  | "quick-colour-scheme"
  | "quick-accent"
  | "quick-font-size-smaller"
  | "quick-font-size-larger"
  | "quick-translucency"
  | "quick-rail";

export type PaletteQuickSetting = {
  id: QuickSettingId;
  label: string;
  value: string;
  icon: string;
  page?: PaletteQuickPage;
};

export type QuickSettingsState = {
  scheme: "light" | "dark" | "system";
  accent: string;
  fontSize: number;
  translucent: boolean;
  translucency: boolean;
  railOpen: boolean;
};

const SCHEME_LABELS = { light: "Light", dark: "Dark", system: "System" } as const;

export function quickSettings(state: QuickSettingsState): PaletteQuickSetting[] {
  const rows: PaletteQuickSetting[] = [
    {
      id: "quick-colour-scheme",
      label: "Colour scheme",
      value: SCHEME_LABELS[state.scheme],
      icon: "sun-moon",
    },
    {
      id: "quick-accent",
      label: "Accent colour",
      value: state.accent,
      icon: "swatch-book",
      page: "accent",
    },
  ];
  if (state.fontSize > MIN_FONT_SIZE) {
    rows.push({
      id: "quick-font-size-smaller",
      label: "Text size: smaller",
      value: `${state.fontSize} px`,
      icon: "a-arrow-down",
    });
  }
  if (state.fontSize < MAX_FONT_SIZE) {
    rows.push({
      id: "quick-font-size-larger",
      label: "Text size: larger",
      value: `${state.fontSize} px`,
      icon: "a-arrow-up",
    });
  }
  if (state.translucency) {
    rows.push({
      id: "quick-translucency",
      label: "Translucency",
      value: state.translucent ? "On" : "Off",
      icon: "blend",
    });
  }
  rows.push({
    id: "quick-rail",
    label: "Rail",
    value: state.railOpen ? "Shown" : "Hidden",
    icon: "panel-left",
  });
  return rows;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replaceAll("…", "").replaceAll(/\s+/g, " ").trim();
}

function fieldRank(field: string, needle: string, tokens: readonly string[]): number | undefined {
  if (!tokens.every((token) => field.includes(token))) return undefined;
  if (field === needle) return 3;
  if (field.startsWith(needle)) return 2;
  return field.includes(needle) ? 1 : 0;
}

// With recency, every non-exact title match shares one tier so the newer item wins.
export function matchRank(fields: readonly (string | undefined)[], query: string, recency = false): number | undefined {
  const needle = normalize(query);
  if (!needle) return 0;
  const tokens = needle.split(" ");
  const present = fields.filter((field): field is string => Boolean(field)).map(normalize);
  const haystack = present.join(" ");
  if (!tokens.every((token) => haystack.includes(token))) return undefined;
  for (const [index, field] of present.entries()) {
    const rank = fieldRank(field, needle, tokens);
    if (rank === undefined) continue;
    if (index === 0 && recency) return 1_000 + Number(rank === 3);
    return 1_000 - index * 100 + rank;
  }
  return 0;
}

function ranked<T>(items: readonly T[], query: string, fields: (item: T) => readonly (string | undefined)[], recency?: (item: T) => number): T[] {
  if (!normalize(query)) return [...items];
  return items
    .flatMap((item, index) => {
      const rank = matchRank(fields(item), query, Boolean(recency));
      return rank === undefined ? [] : [{ item, index, rank }];
    })
    .sort((left, right) => right.rank - left.rank || (recency ? recency(right.item) - recency(left.item) : 0) || left.index - right.index)
    .map((entry) => entry.item);
}

export function matchQuick(rows: readonly PaletteQuickSetting[], query: string): PaletteQuickSetting[] {
  return ranked(rows, query, (row) => [row.label, row.value, row.id]);
}

export type PaletteAction = {
  id: CommandId;
  label: string;
  chord: string;
  page?: PaletteSubPage;
};

export type PaletteSessionLike = {
  id: string;
  title: string;
  hostId?: string;
  hostName?: string;
  projectName?: string;
  worktreeBranch?: string;
  projectBranch?: string;
  updatedAt: number;
};

type PaletteSectionId = "actions" | "quick" | "projects" | "settings" | "sessions";

export type PaletteRow<S extends PaletteSessionLike> =
  | ({ kind: "action"; key: string } & PaletteAction)
  | ({ kind: "quick"; key: string } & PaletteQuickSetting)
  | { kind: "project"; key: string; target: NewConversationTarget }
  | { kind: "setting"; key: string; entry: SettingsSearchEntry }
  | { kind: "session"; key: string; session: S };

export type PaletteSection<S extends PaletteSessionLike> = {
  id: PaletteSectionId;
  title: string;
  rows: PaletteRow<S>[];
};

const SECTION_TITLES: Record<PaletteSectionId, string> = {
  actions: "Actions",
  quick: "Quick settings",
  projects: "Projects",
  settings: "Settings",
  sessions: "Recent conversations",
};

export function paletteActions(
  commands: readonly Command[],
  keymap: Keymap,
  runnable: (id: CommandId) => boolean,
  exclude: readonly CommandId[] = [],
): PaletteAction[] {
  const actions: PaletteAction[] = [];
  for (const command of commands) {
    if (command.jump) continue;
    if (exclude.includes(command.id)) continue;
    if (!runnable(command.id)) continue;
    const page = PALETTE_SUB_PAGES[command.id];
    actions.push({
      id: command.id,
      label: command.label,
      chord: keymap[command.id] ?? "",
      ...(page ? { page } : {}),
    });
  }
  return actions;
}

export function matchActions(actions: readonly PaletteAction[], query: string): PaletteAction[] {
  return ranked(actions, query, (action) => [action.label, action.id]);
}

export function sessionBranch(session: PaletteSessionLike): string | undefined {
  return session.worktreeBranch ?? session.projectBranch;
}

export function recentSessions<S extends PaletteSessionLike>(
  sessions: readonly S[],
  query: string,
  limit: number = RECENT_CONVERSATION_LIMIT,
): S[] {
  if (!normalize(query)) return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
  return ranked(
    sessions,
    query,
    (session) => [session.title, session.projectName, sessionBranch(session), session.hostName, session.id],
    (session) => session.updatedAt,
  ).slice(0, limit);
}

export function paletteSessionKey(session: PaletteSessionLike): string {
  return session.hostId ? `${session.hostId}:${session.id}` : session.id;
}

export function paletteSections<S extends PaletteSessionLike>({
  actions,
  quick = [],
  targets,
  settings = [],
  sessions,
  query,
  limit = RECENT_CONVERSATION_LIMIT,
}: {
  actions: readonly PaletteAction[];
  quick?: readonly PaletteQuickSetting[];
  targets: readonly NewConversationTarget[];
  settings?: readonly SettingsSearchEntry[];
  sessions: readonly S[];
  query: string;
  limit?: number;
}): PaletteSection<S>[] {
  const sections: PaletteSection<S>[] = [
    {
      id: "actions",
      title: SECTION_TITLES.actions,
      rows: matchActions(actions, query).map((action) => ({ kind: "action" as const, key: action.id, ...action })),
    },
    {
      id: "quick",
      title: SECTION_TITLES.quick,
      rows: matchQuick(quick, query).map((setting) => ({ kind: "quick" as const, key: setting.id, ...setting })),
    },
    {
      id: "projects",
      title: SECTION_TITLES.projects,
      rows: matchTargets(targets, query).map((target) => ({
        kind: "project" as const,
        key: `${target.hostId ?? "local"}:${target.id}`,
        target,
      })),
    },
    {
      id: "settings",
      title: SECTION_TITLES.settings,
      rows: settings.map((entry) => ({ kind: "setting" as const, key: entry.id, entry })),
    },
    {
      id: "sessions",
      title: SECTION_TITLES.sessions,
      rows: recentSessions(sessions, query, limit).map((session) => ({
        kind: "session" as const,
        key: paletteSessionKey(session),
        session,
      })),
    },
  ];
  return sections.filter((section) => section.rows.length > 0);
}

export function paletteRows<S extends PaletteSessionLike>(sections: readonly PaletteSection<S>[]): PaletteRow<S>[] {
  return sections.flatMap((section) => section.rows);
}

