import { TranscriptionRefused } from "./grant";

const LISTEN_URL = "https://api.deepgram.com/v1/listen";

/** The same model and formatting the cockpit asks for, for one recorded clip. */
export function transcriptionUrl(language: string, keyterms: readonly string[] = [], base: string = LISTEN_URL): string {
  const url = new URL(base);
  url.searchParams.set("model", "nova-3");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("numerals", "true");
  url.searchParams.set("language", language);
  for (const term of keyterms) url.searchParams.append("keyterm", term);
  return url.toString();
}

type Answer = { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };

export function readTranscript(answer: unknown): string {
  return ((answer as Answer | null)?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

/** Appends spoken words to the draft with one space between them. */
export function appendSpoken(draft: string, words: string): string {
  if (!words) return draft;
  return draft && !/\s$/.test(draft) ? `${draft} ${words}` : `${draft}${words}`;
}

export async function transcribe(
  clip: Blob,
  grant: { token: string; language: string; keyterms?: string[] },
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const response = await fetch(transcriptionUrl(grant.language, grant.keyterms), {
    method: "POST",
    headers: { authorization: `Bearer ${grant.token}`, "content-type": clip.type || "audio/mp4" },
    body: clip,
  });
  if (!response.ok) throw new TranscriptionRefused(`The transcription service refused the recording (status ${response.status}).`);
  return readTranscript(await response.json());
}
