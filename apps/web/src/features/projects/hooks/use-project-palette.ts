"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { claimChords } from "@/features/commands";
import {
  cloneRequest,
  hostChoices,
  matchTargets,
  paletteBack,
  pathRequest,
  QUICK_PICK_LIMIT,
  sourceRows,
  THIS_COMPUTER,
  type HostChoice,
  type NewConversationTarget,
  type PalettePage,
  type ProjectSource,
  type Registered,
} from "../palette-model";
import { usePairedHosts } from "./use-paired-hosts";
import { useProjectAdding } from "./use-project-adding";

export type ProjectPalettePage = PalettePage | "hosts" | "local" | "clone-url" | "clone-parent";

const QUICK_PICK_CHORDS = Array.from({ length: QUICK_PICK_LIMIT }, (_, index) => `CommandOrControl+${index + 1}`);

function useQuickPickChords(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    return claimChords(QUICK_PICK_CHORDS);
  }, [active]);
}

type ListKeys = { count: number; index: number; pick: (at: number) => void; step: (delta: number) => void; back: (() => void) | undefined };

function listKey(event: React.KeyboardEvent, { count, index, pick, step, back }: ListKeys) {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
  if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    pick(Number(event.key) - 1);
    return;
  }
  if (event.key === "Backspace" && back) {
    event.preventDefault();
    back();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (count === 0) return;
    event.preventDefault();
    step(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    pick(index);
  }
}

function useSourceSteps({
  page,
  query,
  busy,
  go,
  setNotice,
  addLocalFolder,
  cloneInto,
}: {
  page: ProjectPalettePage;
  query: string;
  busy: boolean;
  go: (next: ProjectPalettePage) => void;
  setNotice: (notice: string | undefined) => void;
  addLocalFolder: (root: string) => Promise<void>;
  cloneInto: (url: string, parent: string) => Promise<void>;
}) {
  const [cloneUrl, setCloneUrl] = useState<string>();
  const [startAt, setStartAt] = useState<string>();

  const reset = () => {
    setCloneUrl(undefined);
    setStartAt(undefined);
  };

  const submitFolder = (root: string) => void (page === "local" ? addLocalFolder(root) : cloneUrl && cloneInto(cloneUrl, root));

  const pickSource = (source: ProjectSource | undefined) => {
    if (!source || busy) return;
    if (source.setupRequired) {
      setNotice(`${source.title} is not set up yet. Clone it yourself and add it as a local folder.`);
      return;
    }
    if (!source.clones) {
      setStartAt(pathRequest(query));
      go("local");
      return;
    }
    const clone = cloneRequest(query);
    setCloneUrl(clone?.url);
    go(clone ? "clone-parent" : "clone-url");
  };

  const takeCloneUrl = (typed: string) => {
    const clone = cloneRequest(typed);
    if (!clone) {
      setNotice("That is not a clone URL. Paste an https, ssh or git URL — or owner/repo.");
      return;
    }
    setCloneUrl(clone.url);
    go("clone-parent");
  };

  return { startAt, reset, submitFolder, pickSource, takeCloneUrl };
}

export function useProjectPalette({
  open,
  openOn,
  targets,
  onClose,
  onChoose,
  onRegistered,
  onBack,
}: {
  open: boolean;
  openOn: PalettePage;
  targets: readonly NewConversationTarget[];
  onClose: () => void;
  onChoose: (target: NewConversationTarget) => void;
  onRegistered: (registered: Registered) => void;
  onBack: (() => void) | undefined;
}) {
  const [page, setPage] = useState<ProjectPalettePage>(openOn);
  const [query, setQuery] = useState("");
  const composing = useRef(false);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [host, setHost] = useState<HostChoice>(THIS_COMPUTER);
  const [followHosts, setFollowHosts] = useState(openOn === "sources");
  const hosts = usePairedHosts(open);
  const { busy, setBusy, addLocalFolder, cloneInto, pickWithSystem } = useProjectAdding({ hostId: host.id, onClose, onRegistered, setNotice });

  const matches = useMemo(() => matchTargets(targets, query), [targets, query]);
  const rows = useMemo(() => sourceRows(query), [query]);
  const choices = useMemo(() => hostChoices(hosts ?? [], query), [hosts, query]);
  const count = page === "projects" ? matches.length + 1 : page === "hosts" ? choices.length : rows.length;
  const addPage: ProjectPalettePage = hosts?.length ? "hosts" : "sources";

  const go = (next: ProjectPalettePage) => {
    setPage(next);
    setQuery("");
    setIndex(0);
    setNotice(undefined);
    setFollowHosts(false);
  };
  const sources = useSourceSteps({ page, query, busy, go, setNotice, addLocalFolder, cloneInto });

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPage(openOn);
      setQuery("");
      setIndex(0);
      setBusy(false);
      setNotice(undefined);
      sources.reset();
      setHost(THIS_COMPUTER);
      setFollowHosts(openOn === "sources");
    }
  }
  if (open && followHosts && (page === "sources" || page === "hosts") && page !== addPage) setPage(addPage);

  useQuickPickChords(open && (page === "projects" || page === "sources" || page === "hosts"));

  const goAdd = () => {
    go(addPage);
    setFollowHosts(true);
  };

  const backRoot: PalettePage = onBack ? openOn : "projects";
  const list: PalettePage = page === "sources" || page === "hosts" ? "sources" : "projects";
  const toHosts = page === "sources" && addPage === "hosts";
  const backsTo: ReturnType<typeof paletteBack> | "hosts" = toHosts ? "hosts" : paletteBack(list, "", backRoot);
  const goBack = () => {
    if (backsTo === "hosts") go("hosts");
    else if (backsTo === "projects") go("projects");
    else onBack?.();
  };

  const pickHost = (choice: HostChoice | undefined) => {
    if (!choice || busy) return;
    setHost(choice);
    go("sources");
  };

  const choose = (target: NewConversationTarget | undefined) => {
    if (!target) return;
    onClose();
    onChoose(target);
  };

  const take = (at: number) => {
    if (page === "hosts") {
      pickHost(choices[at]);
      return;
    }
    if (page === "sources") {
      sources.pickSource(rows[at]);
      return;
    }
    if (at >= matches.length) goAdd();
    else choose(matches[at]);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (page !== "projects" && page !== "sources" && page !== "hosts") return;
    if (composing.current) return;
    listKey(event, {
      count,
      pick: take,
      index,
      step: (delta) => setIndex((current) => (current + delta + count) % count),
      back: (toHosts ? query === "" : paletteBack(list, query, backRoot)) ? goBack : undefined,
    });
  };

  const search = (next: string) => {
    setQuery(next);
    setIndex(0);
    setNotice(undefined);
    setFollowHosts(false);
  };

  return {
    page,
    query,
    search,
    composing,
    index,
    setIndex,
    count,
    matches,
    rows,
    choices,
    host,
    pickHost,
    goAdd,
    notice,
    setNotice,
    busy,
    startAt: sources.startAt,
    backsTo,
    go,
    goBack,
    choose,
    submitFolder: sources.submitFolder,
    pickWithSystem,
    pickSource: sources.pickSource,
    takeCloneUrl: sources.takeCloneUrl,
    onKeyDown,
  };
}
