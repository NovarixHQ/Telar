"use client";

import type { RefObject } from "react";
import { ArrowLeftIcon, FolderPlusIcon, MonitorIcon, SearchIcon, ServerIcon } from "lucide-react";
import { LOCAL_HOST_ID } from "@telar/engine-client";
import { ProjectAvatar } from "./project-avatar";
import { PaletteRow } from "./palette-row";
import { paletteBack, QUICK_PICK_LIMIT, targetPlace, type HostChoice, type NewConversationTarget, type ProjectSource } from "../palette-model";

function ProjectMatches({
  targets,
  matches,
  at,
  onChoose,
  onAdd,
  onHover,
}: {
  targets: readonly NewConversationTarget[];
  matches: readonly NewConversationTarget[];
  at: number;
  onChoose: (target: NewConversationTarget) => void;
  onAdd: () => void;
  onHover: (row: number) => void;
}) {
  return (
    <>
      {matches.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {targets.length === 0 ? "No projects registered yet." : "No project matches that."}
        </p>
      )}
      {matches.map((target, row) => (
        <PaletteRow
          key={`${target.hostId ?? "local"}:${target.id}`}
          id={`project-palette-projects-${row}`}
          on={row === at}
          onPick={() => onChoose(target)}
          onHover={() => onHover(row)}
          glyph={
            <ProjectAvatar
              name={target.name}
              projectId={target.id}
              {...(target.hostId ? { hostId: target.hostId } : {})}
              {...(target.icon ? { icon: target.icon } : {})}
              {...(target.iconName ? { iconName: target.iconName } : {})}
              size={16}
            />
          }
          title={target.name}
          hint={targetPlace(target)}
          mono
          {...(row < QUICK_PICK_LIMIT ? { key9: row + 1 } : {})}
        />
      ))}
      <PaletteRow
        id={`project-palette-projects-${matches.length}`}
        on={at === matches.length}
        onPick={onAdd}
        onHover={() => onHover(matches.length)}
        glyph={<FolderPlusIcon className="size-4 text-muted-foreground" />}
        title="Add a project…"
        hint="A folder, or a repository to clone"
      />
    </>
  );
}

function HostRows({ choices, at, onPick, onHover }: { choices: readonly HostChoice[]; at: number; onPick: (host: HostChoice) => void; onHover: (row: number) => void }) {
  return (
    <>
      {choices.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No computer matches that.</p>}
      {choices.map((host, row) => {
        const Glyph = host.id === LOCAL_HOST_ID ? MonitorIcon : ServerIcon;
        return (
          <PaletteRow
            key={host.id}
            id={`project-palette-hosts-${row}`}
            on={row === at}
            onPick={() => onPick(host)}
            onHover={() => onHover(row)}
            glyph={<Glyph className="size-4 text-muted-foreground" />}
            title={host.name}
            hint={host.hint}
            {...(row < QUICK_PICK_LIMIT ? { key9: row + 1 } : {})}
          />
        );
      })}
    </>
  );
}

function SourceRows({
  rows,
  at,
  onPick,
  onHover,
}: {
  rows: readonly ProjectSource[];
  at: number;
  onPick: (source: ProjectSource) => void;
  onHover: (row: number) => void;
}) {
  return (
    <>
      {rows.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No source matches that.</p>}
      {rows.map((source, row) => (
        <PaletteRow
          key={source.id}
          id={`project-palette-sources-${row}`}
          on={row === at}
          dim={Boolean(source.setupRequired)}
          onPick={() => onPick(source)}
          onHover={() => onHover(row)}
          glyph={<source.icon className="size-4 text-muted-foreground" />}
          title={source.title}
          hint={source.hint}
          mono={source.hint.startsWith("Clone ")}
          badge={
            source.setupRequired ? (
              <span className="shrink-0 rounded border px-1.5 py-0.5 text-3xs text-muted-foreground">Setup Required</span>
            ) : undefined
          }
        />
      ))}
    </>
  );
}

export function PaletteListPage({
  page,
  query,
  onQuery,
  composingRef,
  count,
  at,
  targets,
  matches,
  rows,
  choices,
  hostName,
  notice,
  backsTo,
  showBack,
  onBack,
  onChoose,
  onAdd,
  onPickSource,
  onPickHost,
  onHover,
}: {
  page: "projects" | "sources" | "hosts";
  query: string;
  onQuery: (query: string) => void;
  composingRef: RefObject<boolean>;
  count: number;
  at: number;
  targets: readonly NewConversationTarget[];
  matches: readonly NewConversationTarget[];
  rows: readonly ProjectSource[];
  choices: readonly HostChoice[];
  hostName?: string;
  notice: string | undefined;
  backsTo: ReturnType<typeof paletteBack> | "hosts";
  showBack: boolean;
  onBack: () => void;
  onChoose: (target: NewConversationTarget) => void;
  onAdd: () => void;
  onPickSource: (source: ProjectSource) => void;
  onPickHost: (host: HostChoice) => void;
  onHover: (row: number) => void;
}) {
  const sources = page === "sources";
  const search = page === "hosts" ? "Search computers" : sources ? "Search sources, or paste a URL or folder path" : "Search projects";
  const backLabel = backsTo === "projects" ? "Back to projects" : backsTo === "hosts" ? "Back to computers" : "Back";
  const heading = page === "hosts" ? "Computers" : sources ? (hostName ? `Sources on ${hostName}` : "Sources") : "Projects";
  return (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        {showBack ? (
          <button
            type="button"
            aria-label={backLabel}
            title={backLabel}
            onClick={onBack}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        ) : (
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <input
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          placeholder={search}
          aria-label={search}
          role="combobox"
          aria-expanded={count > 0}
          aria-controls="project-palette-results"
          aria-activedescendant={at >= 0 ? `project-palette-${page}-${at}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div id="project-palette-results" role="listbox" aria-label={heading} className="max-h-80 overflow-y-auto p-1.5">
        <p aria-hidden className="px-2 pt-1 pb-1.5 text-2xs font-medium text-muted-foreground">
          {heading}
        </p>
        {page === "hosts" ? (
          <HostRows choices={choices} at={at} onPick={onPickHost} onHover={onHover} />
        ) : sources ? (
          <SourceRows rows={rows} at={at} onPick={onPickSource} onHover={onHover} />
        ) : (
          <ProjectMatches targets={targets} matches={matches} at={at} onChoose={onChoose} onAdd={onAdd} onHover={onHover} />
        )}
      </div>

      {notice && (
        <p className="border-t px-3 py-2 text-2xs leading-snug text-muted-foreground" role="status">
          {notice}
        </p>
      )}

      <div className="flex items-center gap-4 border-t px-3 py-2 text-2xs text-muted-foreground">
        <span>
          <kbd className="font-sans">↑↓</kbd> Navigate
        </span>
        <span>
          <kbd className="font-sans">Enter</kbd> Select
        </span>
        {showBack && (
          <span>
            <kbd className="font-sans">Backspace</kbd> Back
          </span>
        )}
        <span>
          <kbd className="font-sans">Esc</kbd> Close
        </span>
      </div>
    </>
  );
}
