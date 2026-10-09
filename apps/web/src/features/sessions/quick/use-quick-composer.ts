"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveSessionRow, Project } from "@telar/engine-client";
import { asEngineError, createEngineApi, newRunId } from "@/platform/engine";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { composerProject, MAX_ATTACHMENTS, readFrontDoorNote } from "@/features/composer";
import { projectDraftModel } from "@telar/client/providers";
import { useDraftConfig } from "../cockpit/hooks/use-draft-config";
import { startSession } from "../cockpit/start-session";
import { sessionHref } from "../session-list";
import { contextOffers, type ContextOffer, type FrontContext, type QuickComposerBridge } from "./front-context";
import { destinationQuery } from "./destination";
import { needsYou } from "./needs-you";
import { useDestination } from "./use-destination";

const api = createEngineApi();

async function reply(sessionId: string, text: string, files: readonly File[]) {
  const attachments: string[] = [];
  for (const file of files) attachments.push((await api.uploadAttachment(sessionId, file)).attachment.id);
  await api.submitTurn(sessionId, { runId: newRunId(), input: text, ...(attachments.length > 0 ? { attachments } : {}) });
}

function useProjects() {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(() => readFrontDoorNote()?.composer);
  useEffect(() => {
    void api.projects().then(({ projects: listed }) => {
      setProjects(listed);
      setProjectId((current) => (listed.some((project) => project.id === current) || listed.length === 0 ? current : composerProject(listed, [])));
    }, () => undefined);
  }, []);
  const project = projects.find((candidate) => candidate.id === projectId);
  const defaults = useMemo(
    () => (project ? { projectId: project.id, model: projectDraftModel(project.defaultModel), ...(project.envMode ? { envMode: project.envMode } : {}) } : undefined),
    [project],
  );
  return { projects, projectId, setProjectId, project, defaults };
}

export function useQuickComposer(bridge: QuickComposerBridge | undefined) {
  const { projects, projectId, setProjectId, project, defaults } = useProjects();
  const draft = useDraftConfig({ projectId, fresh: true, projectDefaults: defaults });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [context, setContext] = useState<FrontContext | null>(null);
  const [offers, setOffers] = useState<readonly ContextOffer[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const openAfter = useRef(false);
  const offered = useRef<readonly ContextOffer[]>([]);
  const [sessions, setSessions] = useState<readonly LiveSessionRow[]>([]);
  const [opened, setOpened] = useState(0);
  const [nudge, setNudge] = useState(0);
  const destination = useDestination({ text, setText, sessions, projects, projectId, onProject: setProjectId });
  const picking = destinationQuery(text) !== null;
  const { clear } = destination;

  useEffect(() => {
    void api.liveSessions({ all: true }).then((page) => setSessions(page.sessions), () => undefined);
  }, [opened, picking, nudge]);

  useEffect(() => {
    if (!bridge) return;
    const adopt = (next: FrontContext | null) => {
      setContext(next);
      setOpened((count) => count + 1);
      if (next?.fresh) {
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
  }, [bridge, clear]);

  const toggleOffer = (offer: ContextOffer) =>
    setFiles((current) => (current.includes(offer.file) ? current.filter((file) => file !== offer.file) : [...current, offer.file].slice(0, MAX_ATTACHMENTS)));

  const submit = async () => {
    const target = destination.destination;
    if (!projectId && target?.kind !== "session") return;
    const open = openAfter.current;
    openAfter.current = false;
    const sent = { text: text.trim(), files };
    setSending(true);
    setText("");
    setFiles([]);
    try {
      if (target?.kind === "session") {
        await reply(target.session.id, sent.text, sent.files);
        setError(undefined);
        setNudge((count) => count + 1);
        if (!open) return;
        const route = sessionHref({ id: target.session.id, projectId: target.session.projectId ?? "", hostId: LOCAL_HOST_ID });
        await bridge?.sent({ route, title: target.session.title, detail: target.projectName, open });
        return;
      }
      if (!projectId) return;
      const envMode = target?.kind === "project" ? target.envMode : draft.envMode;
      const session = await startSession(api, { projectId, text: sent.text, files: sent.files, choices: { ...draft, envMode } });
      destination.clear();
      setError(undefined);
      await bridge?.sent({ route: sessionHref({ id: session.id, projectId, hostId: LOCAL_HOST_ID }), title: session.title, detail: project?.name ?? "", open });
    } catch (cause) {
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

  const attachedId = destination.destination?.kind === "session" ? destination.destination.session.id : undefined;
  const edit = (next: string) => {
    if (attachedId && destinationQuery(next) !== null && destinationQuery(text) === null) clear();
    setText(next);
  };
  const needs = useMemo(() => needsYou(sessions, projects, attachedId), [sessions, projects, attachedId]);

  return { projects, projectId, setProjectId, project, draft, text, setText, edit, files, setFiles, context, offers, toggleOffer, destination, needs, nudge, sending, error, submit, noteKey, forgetKey };
}
