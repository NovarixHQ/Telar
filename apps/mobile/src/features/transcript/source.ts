import { createContext } from "react";
import type { HostConnection } from "../../platform/connection";

/** Where the transcript's attachments come from, and where a file picked from it goes: the editor, or the composer as a reference. */
export type TranscriptSource = { host: HostConnection; sessionId: string; onOpenFile?: (path: string) => void; onReference?: (text: string) => void };

export const SourceContext = createContext<TranscriptSource | undefined>(undefined);

/** The newest version of each artifact in the session, so older cards can say they were replaced. */
export const ArtifactVersions = createContext<ReadonlyMap<string, number>>(new Map());

const loaded = new Map<string, Promise<string>>();
const KEEP = 32;

/** An attachment's text, read once per session and kept for the last few cards. */
export function attachmentText(source: TranscriptSource, attachmentId: string): Promise<string> {
  const key = `${source.host.hostId}/${source.sessionId}/${attachmentId}`;
  let text = loaded.get(key);
  if (!text) {
    text = source.host.call(true, () => source.host.client.attachmentBytes(source.sessionId, attachmentId)).then(({ data }) => new TextDecoder().decode(data));
    text.catch(() => loaded.delete(key));
    loaded.set(key, text);
    if (loaded.size > KEEP) loaded.delete(loaded.keys().next().value!);
  }
  return text;
}
