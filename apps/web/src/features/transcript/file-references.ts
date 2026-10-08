import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { FileReference } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { TranscriptSession } from "./components/message-attachments";

const INLINE_CODE = /(`+)([^`\n]+?)\1(?!`)/g;
const MISS_MS = 60_000;
const MAX_ENTRIES = 4_000;
const NONE: ReadonlyMap<string, FileReference> = new Map();

function fileReferenceCandidates(markdown: string): string[] {
  const found = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    for (const match of line.matchAll(INLINE_CODE)) {
      const text = match[2]!.trim();
      if (text.length > 300 || /[\s<>|*?"']/.test(text) || text.includes("://")) continue;
      const base = text.replace(/(:\d+)+$|#L\d.*$/, "").split("/").pop() ?? "";
      if (base.includes(".") || text.includes("/")) found.add(text);
    }
  }
  return [...found];
}

type Source = { sessionId: string; hostId?: string };
type Entry = { reference: FileReference | null; at: number };

const answers = new Map<string, Entry>();
const keyOf = (source: Source, text: string) => `${source.hostId ?? LOCAL_HOST_ID}\0${source.sessionId}\0${text}`;

function found(source: Source, texts: readonly string[]): Map<string, FileReference> {
  const references = new Map<string, FileReference>();
  for (const text of texts) {
    const reference = answers.get(keyOf(source, text))?.reference;
    if (reference) references.set(text, reference);
  }
  return references;
}

function missing(source: Source, texts: readonly string[], now: number): string[] {
  return texts.filter((text) => {
    const entry = answers.get(keyOf(source, text));
    return !entry || (!entry.reference && now - entry.at > MISS_MS);
  });
}

let version = 0;
const listeners = new Set<() => void>();

function remember(source: Source, resolved: ReadonlyMap<string, FileReference>, texts: readonly string[], now: number): void {
  for (const text of texts) {
    const key = keyOf(source, text);
    answers.delete(key);
    answers.set(key, { reference: resolved.get(text) ?? null, at: now });
    if (answers.size > MAX_ENTRIES) answers.delete(answers.keys().next().value!);
  }
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A finished message's file references, resolved in one engine call and cached per session; until then nothing is a chip. */
export function useFileReferences(markdown: string | undefined): ReadonlyMap<string, FileReference> {
  const source = useContext(TranscriptSession);
  const sessionId = source?.sessionId;
  const hostId = source?.hostId;
  const texts = useMemo(() => (markdown ? fileReferenceCandidates(markdown) : []), [markdown]);
  const seen = useSyncExternalStore(subscribe, () => version, () => version);
  const resolved = useMemo(
    () => (seen >= 0 && sessionId && texts.length ? found({ sessionId, ...(hostId ? { hostId } : {}) }, texts) : NONE),
    [sessionId, hostId, texts, seen],
  );
  useEffect(() => {
    if (!sessionId || !texts.length) return;
    const where: Source = { sessionId, ...(hostId ? { hostId } : {}) };
    const unknown = missing(where, texts, Date.now());
    if (!unknown.length) return;
    createEngineApi(hostFetcher(hostId ?? LOCAL_HOST_ID))
      .sessionFileReferences(sessionId, unknown)
      .then(({ references }) => remember(where, new Map(references.map((reference) => [reference.text, reference])), unknown, Date.now()))
      .catch(() => {});
  }, [sessionId, hostId, texts]);
  return resolved;
}
