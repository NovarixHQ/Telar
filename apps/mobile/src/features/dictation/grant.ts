import type { DictationDiagnosisAnswer, DictationTokenAnswer } from "@telar/engine-client";

export type Grant = { token: string; language: string; keyterms: string[]; expiresAt: number };

export const MIC_REFUSED = "Telar does not have permission to use the microphone. Allow it in Settings and tap again.";

const AUTOMATIC = "multi";
const MARGIN_MS = 10_000;

export class TranscriptionRefused extends Error {}

export function grantOf(answer: DictationTokenAnswer): Grant {
  if (answer.provider !== "deepgram") throw new Error(`This version of Telar cannot dictate with ${answer.provider}. Update the app, or choose another provider in that computer's Dictation settings.`);
  return { token: answer.token, language: answer.language?.trim() || AUTOMATIC, keyterms: answer.keyterms ?? [], expiresAt: answer.expiresAt };
}

export async function freshGrant(current: Grant, mint: () => Promise<DictationTokenAnswer>, now = Date.now()): Promise<Grant> {
  return current.expiresAt - MARGIN_MS > now ? current : grantOf(await mint());
}

export async function explain(error: unknown, diagnose: () => Promise<DictationDiagnosisAnswer>): Promise<string> {
  const said = error instanceof Error ? error.message : String(error);
  if (!(error instanceof TranscriptionRefused)) return said;
  try {
    const { reason } = await diagnose();
    return reason.trim() || said;
  } catch {
    return said;
  }
}
