import { expect, test } from "bun:test";
import type { DictationTokenAnswer } from "@telar/engine-client";
import { explain, freshGrant, grantOf, TranscriptionRefused } from "./grant";

const minted = (patch: Partial<DictationTokenAnswer> = {}): DictationTokenAnswer => ({ provider: "deepgram", token: "t1", expiresAt: 1_000_000, language: "es", keyterms: ["Telar"], ...patch });

test("a Deepgram token becomes a grant, with a blank language heard as automatic", () => {
  expect(grantOf(minted())).toEqual({ token: "t1", language: "es", keyterms: ["Telar"], expiresAt: 1_000_000 });
  expect(grantOf(minted({ language: "", keyterms: undefined }))).toMatchObject({ language: "multi", keyterms: [] });
});

test("a provider this app can't stream to is refused before the microphone is touched", () => {
  expect(() => grantOf(minted({ provider: "off" }))).toThrow("cannot dictate with off");
});

test("a grant that ran out while recording is minted again", async () => {
  let mints = 0;
  const mint = async () => (mints++, minted({ token: "t2", expiresAt: 2_000_000 }));
  const current = grantOf(minted());
  expect(await freshGrant(current, mint, 900_000)).toBe(current);
  expect((await freshGrant(current, mint, 995_000)).token).toBe("t2");
  expect(mints).toBe(1);
});

test("a refused transcription is explained by the computer's diagnosis", async () => {
  const diagnose = async () => ({ fault: "refused" as const, reason: "The Deepgram key was revoked." });
  expect(await explain(new TranscriptionRefused("status 401"), diagnose)).toBe("The Deepgram key was revoked.");
  expect(await explain(new TranscriptionRefused("status 401"), async () => Promise.reject(new Error("offline")))).toBe("status 401");
  expect(await explain(new Error("Nothing was recorded."), diagnose)).toBe("Nothing was recorded.");
});
