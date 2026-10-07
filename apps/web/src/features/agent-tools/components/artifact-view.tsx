"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { mermaid } from "@streamdown/mermaid";
import { artifactThemeCss, mermaidThemeVariables, type Artifact, type ArtifactTheme } from "@telar/engine-client";
import { useAppearance, useFontFaces } from "@/features/appearance";
import { attachmentUrl } from "@/features/plugins";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { MessageResponse } from "@/ui/message";
import { ARTIFACT_SANDBOX, artifactDocument, frameHeight, hostContextMessage, measuredHeight, savedFileName, type ArtifactHeight } from "../artifacts";
import { useArtifactTheme } from "../artifact-theme";
import { svgImage } from "../svg-image";
import { readableScale } from "../viewport";
import { SvgViewer } from "./svg-viewer";

type Diagram = { source: string; look: string; svg?: string; error?: string };

function useMermaidSvg(source: string, theme: ArtifactTheme): Diagram {
  const id = `artifact-mermaid-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const look = useMemo(() => JSON.stringify(theme), [theme]);
  const [diagram, setDiagram] = useState<Diagram>({ source, look });
  useEffect(() => {
    let live = true;
    mermaid
      .getMermaid({ theme: "base", themeVariables: mermaidThemeVariables(theme), htmlLabels: false, flowchart: { htmlLabels: false } })
      .render(id, source)
      .then(({ svg }) => live && setDiagram({ source, look, svg }))
      .catch((error: unknown) => live && setDiagram({ source, look, error: error instanceof Error ? error.message : String(error) }));
    return () => {
      live = false;
    };
  }, [id, source, look, theme]);
  return diagram.source === source && diagram.look === look ? diagram : { source, look };
}

function MermaidDiagram({ source, title, actions }: { source: string; title: string; actions: React.ReactNode }) {
  const theme = useArtifactTheme();
  const { svg, error } = useMermaidSvg(source, theme);
  if (error) return <p className="py-2 text-xs text-muted-foreground">This diagram could not be drawn: {error}</p>;
  if (svg === undefined) return null;
  return <Drawing source={svg} title={title} theme={theme} actions={actions} />;
}

function Drawing({ source, title, theme, actions }: { source: string; title: string; theme: ArtifactTheme; actions: React.ReactNode }) {
  const image = useMemo(() => svgImage(source, artifactThemeCss(theme)), [source, theme]);
  const minScale = useMemo(() => readableScale(source), [source]);
  if (!image) return <p className="py-2 text-xs text-muted-foreground">This drawing is not a valid svg.</p>;
  return <SvgViewer image={image} title={title} minScale={minScale} actions={actions} />;
}

function SvgDrawing({ source, title, actions }: { source: string; title: string; actions: React.ReactNode }) {
  return <Drawing source={source} title={title} theme={useArtifactTheme()} actions={actions} />;
}

type Loaded = { attachmentId: string; text?: string; failed?: boolean };

function useArtifactText(hostId: string, sessionId: string, attachmentId: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ attachmentId });
  useEffect(() => {
    const controller = new AbortController();
    hostFetcher(hostId)(attachmentUrl(sessionId, attachmentId), { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => setLoaded({ attachmentId, text }))
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ attachmentId, failed: true });
      });
    return () => controller.abort();
  }, [hostId, sessionId, attachmentId]);
  return loaded.attachmentId === attachmentId ? loaded : { attachmentId };
}

const measured = new Map<string, number>();

function useMeasureKey(attachmentId: string): string {
  return `${useAppearance().appearance.chatWidth}:${attachmentId}`;
}

function HtmlFrame({ content, title, attachmentId, hint }: { content: string; title: string; attachmentId: string; hint: number | undefined }) {
  const frame = useId();
  const ref = useRef<HTMLIFrameElement>(null);
  const key = useMeasureKey(attachmentId);
  const [reported, setReported] = useState<{ key: string; height: number }>();
  const height = reported?.key === key ? reported.height : (measured.get(key) ?? reported?.height);
  const look = useArtifactTheme(ref);
  const fonts = useFontFaces([look.variables["--font-sans"], look.variables["--font-mono"]]);
  const theme = useMemo(() => (fonts ? { ...look, fonts } : look), [look, fonts]);
  const [doc, setDoc] = useState(() => ({ content, srcDoc: artifactDocument(content, frame, theme) }));
  if (doc.content !== content) setDoc({ content, srcDoc: artifactDocument(content, frame, theme) });
  const [loaded, setLoaded] = useState(false);
  const onLoad = () => {
    setLoaded(true);
    ref.current?.contentWindow?.postMessage(hostContextMessage(theme), "*");
  };
  useEffect(() => {
    ref.current?.contentWindow?.postMessage(hostContextMessage(theme), "*");
  }, [theme]);
  useLayoutEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      const data = event.data as Partial<ArtifactHeight> | null;
      if (data?.artifactFrame !== frame) return;
      const next = measuredHeight(data.height);
      if (next === undefined) return;
      measured.set(key, next);
      setReported({ key, height: next });
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [frame, key]);
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox={ARTIFACT_SANDBOX}
      srcDoc={doc.srcDoc}
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      className="block w-full border-0 bg-transparent"
      style={{ colorScheme: loaded ? theme.scheme : "light", height: frameHeight(hint, height) }}
    />
  );
}

function ArtifactActions({ artifact, text }: { artifact: Artifact; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(text).then(() => setCopied(true));
  const save = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    link.download = savedFileName(artifact);
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <>
      <button type="button" onClick={copy} onPointerLeave={() => setCopied(false)} className={ACTION}>
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        {copied ? "Copied" : "Copy source"}
      </button>
      <button type="button" onClick={save} className={ACTION}>
        <DownloadIcon className="size-3" />
        Save
      </button>
    </>
  );
}

const ACTION = "inline-flex h-6 items-center gap-1 rounded px-1.5 text-3xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

const HOVER_BAR = "absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/90 p-0.5 opacity-0 shadow-1 transition-opacity duration-150 group-hover/artifact:opacity-100 group-focus-within/artifact:opacity-100 pointer-coarse:opacity-100";

export function ArtifactView({ hostId = LOCAL_HOST_ID, sessionId, artifact }: { hostId?: string; sessionId: string; artifact: Artifact }) {
  const { text, failed } = useArtifactText(hostId, sessionId, artifact.attachmentId);
  const measureKey = useMeasureKey(artifact.attachmentId);
  if (failed) return <p className="py-2 text-xs text-muted-foreground">Unable to load {artifact.title}.</p>;
  if (text === undefined) return artifact.kind === "html" ? <div style={{ height: frameHeight(artifact.height, measured.get(measureKey)) }} /> : null;
  const actions = <ArtifactActions artifact={artifact} text={text} />;
  if (artifact.kind === "svg") return <SvgDrawing source={text} title={artifact.title} actions={actions} />;
  if (artifact.kind === "mermaid") return <MermaidDiagram source={text} title={artifact.title} actions={actions} />;
  return (
    <div className="group/artifact relative">
      {artifact.kind === "html" ? <HtmlFrame content={text} title={artifact.title} attachmentId={artifact.attachmentId} hint={artifact.height} /> : <MessageResponse>{text}</MessageResponse>}
      <div className={HOVER_BAR}>{actions}</div>
    </div>
  );
}
