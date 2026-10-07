"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { mermaid } from "@streamdown/mermaid";
import { artifactThemeCss, mermaidThemeVariables, type Artifact, type ArtifactTheme } from "@telar/engine-client";
import { attachmentUrl } from "@/features/plugins";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { MessageResponse } from "@/ui/message";
import { cn } from "@/ui/utils";
import { ARTIFACT_SANDBOX, artifactDocument, clampFrameHeight, hostContextMessage, type ArtifactHeight } from "../artifacts";
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

function MermaidDiagram({ source, title, fill }: { source: string; title: string; fill: boolean }) {
  const theme = useArtifactTheme();
  const { svg, error } = useMermaidSvg(source, theme);
  if (error) return <p className="px-3 py-2 text-xs text-muted-foreground">This diagram could not be drawn: {error}</p>;
  if (svg === undefined) return <p className="px-3 py-2 text-xs text-muted-foreground">Drawing…</p>;
  return <Drawing source={svg} title={title} fill={fill} theme={theme} />;
}

const checkerboard = (a: string, b: string): React.CSSProperties => ({ background: `repeating-conic-gradient(${a} 0% 25%, ${b} 0% 50%) 0 0 / 16px 16px` });

function Drawing({ source, title, fill, theme, ground }: { source: string; title: string; fill: boolean; theme: ArtifactTheme; ground?: React.CSSProperties }) {
  const image = useMemo(() => svgImage(source, artifactThemeCss(theme)), [source, theme]);
  const minScale = useMemo(() => readableScale(source), [source]);
  if (!image) return <p className="px-3 py-2 text-xs text-muted-foreground">This drawing is not a valid svg.</p>;
  return <SvgViewer image={image} title={title} minScale={minScale} fill={fill} {...(ground ? { ground } : {})} />;
}

function SvgDrawing({ source, title, fill }: { source: string; title: string; fill: boolean }) {
  const theme = useArtifactTheme();
  const ground = theme.scheme === "dark" ? checkerboard("#3d3d3d", "#343434") : checkerboard("#f3f3f3", "#e8e8e8");
  return <Drawing source={source} title={title} fill={fill} theme={theme} ground={ground} />;
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

function HtmlFrame({ content, title, fill }: { content: string; title: string; fill: boolean }) {
  const frame = useId();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  const theme = useArtifactTheme(ref);
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
  useEffect(() => {
    if (fill) return;
    const listen = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      const data = event.data as Partial<ArtifactHeight> | null;
      if (data?.artifactFrame !== frame) return;
      const next = clampFrameHeight(data.height);
      if (next !== undefined) setHeight(next);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [fill, frame]);
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox={ARTIFACT_SANDBOX}
      srcDoc={doc.srcDoc}
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      className={cn("block w-full border-0 bg-transparent", fill && "h-full")}
      style={{ colorScheme: loaded ? theme.scheme : "light", ...(fill ? {} : { height: height ?? 160 }) }}
    />
  );
}

export function ArtifactView({ hostId = LOCAL_HOST_ID, sessionId, artifact, fill = false }: { hostId?: string; sessionId: string; artifact: Artifact; fill?: boolean }) {
  const { text, failed } = useArtifactText(hostId, sessionId, artifact.attachmentId);
  if (failed) return <p className="px-3 py-2 text-xs text-muted-foreground">This artifact could not be loaded.</p>;
  if (text === undefined) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>;
  if (artifact.kind === "html") return <HtmlFrame content={text} title={artifact.title} fill={fill} />;
  if (artifact.kind === "svg") return <SvgDrawing source={text} title={artifact.title} fill={fill} />;
  if (artifact.kind === "mermaid") return <MermaidDiagram source={text} title={artifact.title} fill={fill} />;
  return <MessageResponse className="px-3 py-2">{text}</MessageResponse>;
}
