"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { asEngineError, newRunId } from "@/platform/engine";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { composerProject, MAX_ATTACHMENTS, readFrontDoorNote } from "@/features/composer";
import { projectDraftModel } from "@telar/client/providers";
import { useDraftConfig } from "../cockpit/hooks/use-draft-config";
import { startSession } from "../cockpit/start-session";
import { useInboxPolicy } from "../inbox-policy";
import { useRailData } from "../rail/use-rail-data";
import { bandOf, sessionHref, sessionKey, windowFor, type SidebarSession } from "../session-list";
import { contextOffers, type ContextOffer, type FrontContext, type QuickComposerBridge } from "./front-context";
import { destinationQuery } from "./destination";
import { hostApi, projectKey, useHostProjects, type QuickProject } from "./hosts";
import { needsYou } from "./needs-you";
import { useDestination } from "./use-destination";

async function reply(session: SidebarSession, text: string, files: readonly File[]) {
  const api = hostApi(session.hostId);
  const attachments: string[] = [];
  for (const file of files) attachments.push((await api.uploadAttachment(session.id, file)).attachment.id);
  await api.submitTurn(session.id, { runId: newRunId(), input: text, ...(attachments.length > 0 ? { attachments } : {}) });
}

function useProjects(projects: readonly QuickProject[]) {
  const [chosen, setChosen] = useState<string | undefined>(() => {
    const noted = readFrontDoorNote()?.composer;
    return noted ? projectKey({ id: noted, hostId: LOCAL_HOST_ID }) : undefined;
  });
  const fallback = projects.length > 0 ? projects.find((each) => each.id === composerProject(projects, [])) : undefined;
  const project = projects.find((each) => projectKey(each) === chosen) ?? fallback;
  const defaults = useMemo(
    () => (project ? { projectId: project.id, model: projectDraftModel(project.defaultModel), ...(project.envMode ? { envMode: project.envMode } : {}) } : undefined),
    [project],
  );
  return { project, setProject: setChosen, defaults };
}

type Draft = { text: string; files: File[] };

function useDrafts(key: string, current: Draft, setText: (text: string) => void, setFiles: (files: File[]) => void) {
  const store = useRef(new Map<string, Draft>());
  const shown = useRef(key);
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });
  useEffect(() => {
    if (shown.current === key) return;
    const carried = shown.current === "none" ? latest.current : { text: "", files: [] };
    shown.current = key;
    if (destinationQuery(latest.current.text) !== null) return;
    const saved = store.current.get(key) ?? carried;
    setText(saved.text);
    setFiles(saved.files);
  }, [key, setText, setFiles]);
  return useMemo(
    () => ({
      keep: (draft: Draft) => void store.current.set(shown.current, draft),
      forget: () => store.current.clear(),
    }),
    [],
  );
}

function useBandFor(rail: ReturnType<typeof useRailData>) {
  const { policy } = useInboxPolicy();
  return (session: SidebarSession) => bandOf(session, { now: rail.renderedAt, autoSettleAfterHours: windowFor(session, policy.autoSettleAfterHours, rail.hostWindows) });
}

export function useQuickComposer(bridge: QuickComposerBridge | undefined) {
  const rail = useRailData();
  const projects = useHostProjects(rail.hosts);
  const { project, setProject, defaults } = useProjects(projects);
  const projectId = project?.id;
  const bandFor = useBandFor(rail);
  const draft = useDraftConfig({ projectId, fresh: true, projectDefaults: defaults });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [context, setContext] = useState<FrontContext | null>(null);
  const [offers, setOffers] = useState<readonly ContextOffer[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const openAfter = useRef(false);
  const offered = useRef<readonly ContextOffer[]>([]);
  const [nudge, setNudge] = useState(0);
  const [opened, setOpened] = useState(0);
  const destination = useDestination({ text, setText, sessions: rail.sessions, projects, project, onProject: setProject });
  const { clear } = destination;
  const target = destination.destination;
  const draftKey = target?.kind === "session" ? `session:${sessionKey(target.session)}` : project ? `project:${projectKey(project)}` : "none";
  const drafts = useDrafts(draftKey, { text, files }, setText, setFiles);

  useEffect(() => {
    if (!bridge) return;
    const adopt = (next: FrontContext | null) => {
      setContext(next);
      setOpened((count) => count + 1);
      if (next?.fresh) {
        drafts.forget();
        setText("");
        setFiles([]);
        clear();
      }
      const previous = offered.current;
      offered.current = contextOffers(next);
      setOffers(offered.current);
      setFiles((current) => current.filter((file) => !previous.some((offer) => offer.file === file)));
      document.getElementById("turn-prompt")?.focus();
    };
    void bridge.context().then(adopt, () => undefined);
    const stopOpen = bridge.onOpen(adopt);
    const stopPermissions = bridge.onPermissions((permissions) => setContext((current) => current && { ...current, permissions }));
    return () => {
      stopOpen();
      stopPermissions();
    };
  }, [bridge, clear, drafts]);

  const attach = (next: File[]) => {
    setFiles(next);
    drafts.keep({ text, files: next });
  };
  const toggleOffer = (offer: ContextOffer) => attach(files.includes(offer.file) ? files.filter((file) => file !== offer.file) : [...files, offer.file].slice(0, MAX_ATTACHMENTS));

  const submit = async () => {
    if (!project && target?.kind !== "session") return;
    const open = openAfter.current;
    openAfter.current = false;
    const sent = { text: text.trim(), files };
    setSending(true);
    drafts.keep({ text: "", files: [] });
    setText("");
    setFiles([]);
    try {
      if (target?.kind === "session") {
        await reply(target.session, sent.text, sent.files);
        setError(undefined);
        setNudge((count) => count + 1);
        if (!open) return;
        const route = sessionHref({ id: target.session.id, projectId: target.session.projectId ?? "", hostId: target.session.hostId });
        await bridge?.sent({ route, title: target.session.title, detail: target.session.projectName ?? "", open });
        return;
      }
      if (!project) return;
      const envMode = target?.kind === "project" ? target.envMode : draft.envMode;
      const session = await startSession(hostApi(project.hostId), { projectId: project.id, text: sent.text, files: sent.files, choices: { ...draft, envMode } });
      destination.clear();
      setError(undefined);
      await bridge?.sent({ route: sessionHref({ id: session.id, projectId: project.id, hostId: project.hostId }), title: session.title, detail: project.name ?? "", open });
    } catch (cause) {
      drafts.keep({ text: sent.text, files: sent.files });
      setText(sent.text);
      setFiles(sent.files);
      setError(asEngineError(cause, "Could not start the session.").message);
    } finally {
      setSending(false);
    }
  };

  const noteKey = (event: { key: string; metaKey: boolean; ctrlKey: boolean }) => {
    if (event.key === "Enter") openAfter.current = event.metaKey || event.ctrlKey;
  };
  const forgetKey = () => {
    openAfter.current = false;
  };

  const attachedKey = target?.kind === "session" ? sessionKey(target.session) : undefined;
  const edit = (next: string) => {
    const picking = destinationQuery(next) !== null;
    if (attachedKey && picking && destinationQuery(text) === null) clear();
    if (!picking) drafts.keep({ text: next, files });
    setText(next);
  };
  const needs = needsYou(rail.sessions, bandFor, attachedKey);
  const manyHosts = rail.hosts.length > 0;

  return { projects, projectId, setProject, project, manyHosts, draft, text, setText, edit, files, attach, opened, context, offers, toggleOffer, destination, needs, nudge, sending, error, submit, noteKey, forgetKey };
}
