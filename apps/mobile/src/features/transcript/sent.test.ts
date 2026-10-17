import { expect, test } from "bun:test";
import { bubbleSegments, bubbleShows, cacheFolder, fileName } from "./sent";

test("a sent file keeps its name on disk, without folders or empty names", () => {
  expect(fileName("plot.png")).toBe("plot.png");
  expect(fileName("a/b:c.txt")).toBe("a_b_c.txt");
  expect([fileName(""), fileName("  "), fileName("."), fileName("..")]).toEqual(["attachment", "attachment", "attachment", "attachment"]);
});

test("each attachment is cached in a folder of its own, whatever its ids hold", () => {
  expect(cacheFolder("h1", "s/1", "att 1")).toEqual(["attachments", "h1", "s%2F1", "att%201"]);
});

test("a message of files alone shows just the tiles; an empty one without files says Image", () => {
  expect(bubbleShows("look at this", 2)).toBe("text");
  expect(bubbleShows("  ", 2)).toBe("none");
  expect(bubbleShows("", 0)).toBe("image");
});

test("a skill mention in a sent message is a pill with the skill's name, not its serialized text", () => {
  const segments = bubbleSegments('Use the "deploy" skill to ship it');
  expect(segments?.map((segment) => (segment.type === "chip" ? segment.reference.label : segment.text))).toEqual(["Use ", "deploy", " to ship it"]);
  expect(segments?.[1]).toMatchObject({ type: "chip", reference: { kind: "skill" } });
});

test("a message with no reference keeps its ordinary text path", () => {
  expect(bubbleSegments("just words")).toBeUndefined();
});
