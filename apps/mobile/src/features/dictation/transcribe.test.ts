import { expect, test } from "bun:test";
import { appendSpoken, readTranscript, transcribe, transcriptionUrl } from "./transcribe";

test("the request names the model, language and each key term", () => {
  const url = new URL(transcriptionUrl("es", ["Telar", "worktree"]));
  expect(url.searchParams.get("model")).toBe("nova-3");
  expect(url.searchParams.get("language")).toBe("es");
  expect(url.searchParams.getAll("keyterm")).toEqual(["Telar", "worktree"]);
});

test("the transcript is read from the first alternative, and nothing else is guessed", () => {
  expect(readTranscript({ results: { channels: [{ alternatives: [{ transcript: " open the diff " }] }] } })).toBe("open the diff");
  expect(readTranscript({})).toBe("");
  expect(readTranscript(null)).toBe("");
});

test("spoken words join the draft with one space", () => {
  expect(appendSpoken("", "hello")).toBe("hello");
  expect(appendSpoken("say", "hello")).toBe("say hello");
  expect(appendSpoken("say ", "hello")).toBe("say hello");
  expect(appendSpoken("say", "")).toBe("say");
});

test("a clip is posted with the short-lived token, and a refusal is an error", async () => {
  const seen: { url: string; authorization?: string }[] = [];
  const answer = (status: number) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), authorization: (init?.headers as Record<string, string> | undefined)?.authorization });
      return Response.json({ results: { channels: [{ alternatives: [{ transcript: "hi" }] }] } }, { status });
    }) as typeof fetch;
  const clip = new Blob(["x"], { type: "audio/mp4" });
  expect(await transcribe(clip, { token: "grant", language: "en" }, answer(200))).toBe("hi");
  expect(seen[0]?.authorization).toBe("Bearer grant");
  await expect(transcribe(clip, { token: "grant", language: "en" }, answer(401))).rejects.toThrow("status 401");
});
