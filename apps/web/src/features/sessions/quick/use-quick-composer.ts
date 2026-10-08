"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@telar/engine-client";
import { asEngineError, createEngineApi } from "@/platform/engine";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { composerProject, MAX_ATTACHMENTS, readFrontDoorNote } from "@/features/composer";
import { projectDraftModel } from "@telar/client/providers";
import { useDraftConfig } from "../cockpit/hooks/use-draft-config";
import { startSession } from "../cockpit/start-session";
import { sessionHref } from "../session-list";
import { contextFiles, type FrontContext, type QuickComposerBridge } from "./front-context";

const api = createEngineApi();

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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const fromContext = useRef<readonly File[]>([]);
  const openAfter = useRef(false);

  useEffect(() => {
    if (!bridge) return;
    const adopt = (next: FrontContext | null) => {
      setContext(next);
      const previous = fromContext.current;
      fromContext.current = contextFiles(next);
      setFiles((current) => [...current.filter((file) => !previous.includes(file)), ...fromContext.current].slice(0, MAX_ATTACHMENTS));
      document.getElementById("turn-prompt")?.focus();
    };
    void bridge.context().then(adopt, () => undefined);
    return bridge.onOpen(adopt);
  }, [bridge]);

  const submit = async () => {
    if (!projectId) return;
    const open = openAfter.current;
    openAfter.current = false;
    const sent = { text: text.trim(), files };
    setSending(true);
    setText("");
    setFiles([]);
    try {
      const session = await startSession(api, { projectId, text: sent.text, files: sent.files, choices: draft });
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

  return { projects, projectId, setProjectId, project, draft, text, setText, files, setFiles, context, sending, error, submit, noteKey, forgetKey };
}
