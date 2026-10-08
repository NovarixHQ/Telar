import { expect, test } from "bun:test";
import { applyMention, mentionCandidates, mentionQuery, type MentionTarget } from "./mentions";

const targets: MentionTarget[] = [
  { sessionId: "s_here", title: "This one", projectId: "p1" },
  { sessionId: "s_other", title: "Pricing study", projectId: "p2", projectName: "web" },
  { sessionId: "s_same", title: "Pricing page", projectId: "p1", projectName: "telar" },
  { sessionId: "s_more", title: "Release notes", projectId: "p2" },
];

test("an @ word at the end of the draft is a mention being typed", () => {
  expect(mentionQuery("look at @Pri")).toEqual({ start: 8, query: "pri" });
  expect(mentionQuery("@")).toEqual({ start: 0, query: "" });
  expect(mentionQuery("mail me@home")).toBeUndefined();
  expect(mentionQuery("@done and more")).toBeUndefined();
});

test("candidates match the words, skip this session and rank its project first", () => {
  expect(mentionCandidates(targets, "pricing", { sessionId: "s_here", projectId: "p1" }).map((target) => target.sessionId)).toEqual(["s_same", "s_other"]);
  expect(mentionCandidates(targets, "", { sessionId: "s_here" })).toHaveLength(3);
});

test("picking replaces the @ word with the cockpit's reference sentence", () => {
  const draft = "compare with @pri";
  const text = applyMention(draft, mentionQuery(draft)!, targets[1]!);
  expect(text.startsWith('compare with the "Pricing study" session (s_other), as reference: read it with sessions_read')).toBe(true);
  expect(text.endsWith(" ")).toBe(true);
});
