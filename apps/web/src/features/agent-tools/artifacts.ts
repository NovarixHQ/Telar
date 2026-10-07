import { ARTIFACT_BASE_CSS, ARTIFACT_HEIGHT, artifactRootTag, artifactThemeCss, type Artifact, type ArtifactTheme, type Item } from "@telar/engine-client";

const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

export const ARTIFACT_SANDBOX = "allow-scripts";

const MIN_FRAME_HEIGHT = 48;
const RESTING_FRAME_HEIGHT = 160;

export type ArtifactHeight = { artifactFrame: string; height: number };

export function measuredHeight(height: unknown): number | undefined {
  if (typeof height !== "number" || !Number.isFinite(height)) return undefined;
  return Math.min(ARTIFACT_HEIGHT.max, Math.max(MIN_FRAME_HEIGHT, Math.ceil(height)));
}

export function frameHeight(hint: number | undefined, measured: number | undefined): number {
  return Math.max(MIN_FRAME_HEIGHT, Math.min(hint ?? ARTIFACT_HEIGHT.max, measured ?? hint ?? RESTING_FRAME_HEIGHT));
}

const SAVED_EXTENSIONS = { html: "html", svg: "svg", mermaid: "mmd", markdown: "md" } as const;

export function savedFileName(artifact: Pick<Artifact, "title" | "kind">): string {
  const name = artifact.title.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120).trim();
  return `${name || "Artifact"}.${SAVED_EXTENSIONS[artifact.kind]}`;
}

export function contentHeight(doc: Document): number {
  const body = doc.body;
  const style = getComputedStyle(body);
  let bottom = 0;
  let last: Element | undefined;
  for (const child of body.children) {
    if (child.tagName === "SCRIPT" || child.tagName === "STYLE" || child.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) continue;
    const edge = child.getBoundingClientRect().bottom;
    if (edge >= bottom) [bottom, last] = [edge, child];
  }
  const text = [...body.childNodes].filter((node) => node.nodeType === 3 && node.textContent?.trim());
  for (const node of text) {
    const range = doc.createRange();
    range.selectNode(node);
    bottom = Math.max(bottom, range.getBoundingClientRect().bottom);
  }
  const tail = [last ? getComputedStyle(last).marginBottom : "0", style.paddingBottom, style.borderBottomWidth, style.marginBottom].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  return bottom + (doc.defaultView?.scrollY ?? 0) + tail;
}

const escapeScript = (value: string) => JSON.stringify(value).replaceAll("<", "\\u003c");

const HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";

export const hostContextMessage = (theme: ArtifactTheme) => ({ jsonrpc: "2.0", method: HOST_CONTEXT_CHANGED, params: { theme: theme.scheme, styles: { variables: theme.variables } } });

const themeListener = `<script>(()=>{const sheet=document.currentScript.previousElementSibling;document.currentScript.remove();const css=${artifactThemeCss.toString()};addEventListener("message",(event)=>{const data=event.data;if(event.source!==parent||data?.method!==${escapeScript(HOST_CONTEXT_CHANGED)})return;const scheme=data.params?.theme==="dark"?"dark":"light";sheet.textContent=css({scheme,variables:data.params?.styles?.variables});document.documentElement.dataset.scheme=scheme;});})()</script>`;

export function artifactDocument(content: string, frame: string, theme: ArtifactTheme): string {
  const body = content.replace(/^\s*<!doctype[^>]*>/i, "");
  const report = `<script>(()=>{document.currentScript.remove();const measure=${contentHeight.toString()};const post=()=>parent.postMessage({artifactFrame:${escapeScript(frame)},height:measure(document)},"*");const watch=new ResizeObserver(post);watch.observe(document.documentElement);watch.observe(document.body);new MutationObserver(post).observe(document.body,{childList:true,subtree:true,characterData:true});addEventListener("load",post);document.fonts.ready.then(post);post();})()</script>`;
  return `<!doctype html>${artifactRootTag(theme)}<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><meta charset="utf-8"><style>${artifactThemeCss(theme)}</style>${themeListener}<style>${ARTIFACT_BASE_CSS}</style>${body}${report}`;
}

export function latestArtifacts(items: Iterable<Pick<Item, "detail">>): Map<string, Artifact> {
  const latest = new Map<string, Artifact>();
  for (const item of items) {
    if (item.detail.type !== "artifact") continue;
    const artifact = item.detail.artifact;
    const known = latest.get(artifact.id);
    if (!known || artifact.version > known.version) latest.set(artifact.id, artifact);
  }
  return latest;
}
