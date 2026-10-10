"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PuzzleIcon } from "lucide-react";
import { VIEW_BRIDGE_VERSION, type ViewContext, type ViewHostMessage } from "@telar/engine-client";
import { useArtifactTheme } from "@/features/agent-tools";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { usePluginFrames } from "@/platform/engine/sessions-stream";
import { PanelEmpty } from "@/ui/panel";
import { admit, answer, eventForFrame, type BridgeDeps, type FrameGrant } from "./bridge";
import type { FrameSource } from "./contributions";
import { newNonce, VIEW_SANDBOX, viewDocument } from "./view-document";

export type PluginFrameProps = {
  source: FrameSource;
  path?: string;
  sessionId?: string;
  hostId?: string;
  onOpenFile?: (path: string, line?: number) => void;
  onInsertText?: (text: string) => void;
};

const post = (frame: HTMLIFrameElement | null, message: ViewHostMessage) => frame?.contentWindow?.postMessage(message, "*");

function useFrameDocument(source: FrameSource, api: ReturnType<typeof createEngineApi>, nonce: string) {
  const [state, setState] = useState<{ doc?: string; error?: string }>({});
  const { plugin, view } = source;
  useEffect(() => {
    let cancelled = false;
    const load = async (asset: string) => (await api.pluginAsset(plugin, asset)).text;
    load(view.entry)
      .then((html) => viewDocument(view.entry, html, load, nonce))
      .then(
        (doc) => !cancelled && setState({ doc }),
        (cause: unknown) => !cancelled && setState({ error: cause instanceof Error ? cause.message : "The plugin's view did not load." }),
      );
    return () => {
      cancelled = true;
    };
  }, [api, plugin, view.entry, nonce]);
  return state;
}

/** A plugin's page in a sandboxed frame, spoken to only through the bridge. */
export function PluginFrame({ source, path, sessionId, hostId, onOpenFile, onInsertText }: PluginFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState(newNonce);
  const theme = useArtifactTheme(frame);
  const api = useMemo(() => createEngineApi(hostFetcher(hostId ?? LOCAL_HOST_ID)), [hostId]);
  const { doc, error } = useFrameDocument(source, api, nonce);
  const subscribed = useRef(false);

  const grant: FrameGrant = { plugin: source.plugin, nonce, fileScope: source.fileScope, ...(path ? { path } : {}), ...(sessionId ? { sessionId } : {}) };
  const live = useRef({ grant, onOpenFile, onInsertText });
  useEffect(() => {
    live.current = { grant, onOpenFile, onInsertText };
  });

  useEffect(() => {
    const deps: BridgeDeps = {
      readFile: async (session, file) => (await api.sessionFile(session, file)).file,
      callVerb: (session, plugin, verb, input) => api.sessionPluginVerb(session, plugin, verb, input),
      openFile: (file, line) => live.current.onOpenFile?.(file, line),
      insertText: (text) => live.current.onInsertText?.(text),
      subscribe: () => {
        subscribed.current = true;
      },
    };
    const onMessage = (event: MessageEvent) => {
      const envelope = admit(event, frame.current?.contentWindow, nonce);
      if (!envelope) return;
      answer(envelope.request, live.current.grant, deps).then(
        (value) => post(frame.current, { telarView: VIEW_BRIDGE_VERSION, type: "reply", id: envelope.id, ok: true, value }),
        (cause: unknown) => post(frame.current, { telarView: VIEW_BRIDGE_VERSION, type: "reply", id: envelope.id, ok: false, error: cause instanceof Error ? cause.message : String(cause) }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, nonce]);

  useEffect(() => {
    post(frame.current, { telarView: VIEW_BRIDGE_VERSION, type: "theme", theme });
  }, [theme]);

  usePluginFrames(hostId ?? LOCAL_HOST_ID, (event) => {
    const forwarded = subscribed.current ? eventForFrame(event, source.plugin, sessionId) : undefined;
    if (forwarded) post(frame.current, { telarView: VIEW_BRIDGE_VERSION, type: "event", event: forwarded });
  });

  if (error) return <PanelEmpty icon={<PuzzleIcon />} title={`${source.pluginName} could not draw this`}>{error}</PanelEmpty>;
  if (!doc) return null;
  const context: ViewContext = { plugin: source.plugin, view: source.view.id, ...(path ? { path } : {}) };
  return (
    <iframe
      ref={frame}
      title={`${source.pluginName} · ${source.view.label}`}
      sandbox={VIEW_SANDBOX}
      srcDoc={doc}
      className="block h-full w-full border-0 bg-transparent"
      onLoad={() => post(frame.current, { telarView: VIEW_BRIDGE_VERSION, type: "init", context, theme })}
    />
  );
}
