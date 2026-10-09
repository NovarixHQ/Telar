import type { DictationDiagnosisAnswer, DictationTokenAnswer } from "@telar/engine-client";

export type Grant = { token: string; language: string; keyterms: string[] };

export const MIC_REFUSED = "Telar does not have permission to use the microphone. Allow it in Settings and tap again.";

export const SOCKET_ENDED = "The connection to the transcription service ended.";

const AUTOMATIC = "multi";

export class TranscriptionRefused extends Error {}

export function grantOf(answer: DictationTokenAnswer): Grant {
  if (answer.provider !== "deepgram") throw new Error(`This version of Telar cannot dictate with ${answer.provider}. Update the app, or choose another provider in that computer's Dictation settings.`);
  return { token: answer.token, language: answer.language?.trim() || AUTOMATIC, keyterms: answer.keyterms ?? [] };
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
