import { expect, test } from "bun:test";
import { artifactHeight, artifactHtml as html, artifactScrolls, parseProbe } from "./artifact-document";

const palette = new Proxy({}, { get: () => ({ light: "#FCFCFC", dark: "#0A0A0A" }) }) as Parameters<typeof html>[3];
const artifactHtml = (content: string, kind: string, scheme: "light" | "dark") => html(content, kind, scheme, palette);

test("an artifact page wears the app's palette for its scheme and drops the author's doctype", () => {
  const light = artifactHtml("<!DOCTYPE html><p>Hi</p>", "html", "light");
  expect(light.startsWith('<!doctype html><html data-scheme="light">')).toBe(true);
  expect(light).toContain("--background:#fcfcfc;");
  expect(light).toContain("<p>Hi</p>");
  expect(light).not.toContain("<!DOCTYPE html><p>");
  expect(artifactHtml("<svg/>", "svg", "dark")).toContain("--background:#0a0a0a;");
});

test("the card is as tall as its page, within the agent's hint and the 48–560pt band", () => {
  expect(artifactHeight(undefined)).toBe(160);
  expect(artifactHeight(undefined, 300)).toBe(300);
  expect(artifactHeight({ height: 20, wide: false })).toBe(48);
  expect(artifactHeight({ height: 2000, wide: false })).toBe(560);
  expect(artifactHeight({ height: 400, wide: false }, 240)).toBe(240);
  expect(artifactScrolls({ height: 400, wide: false }, 240)).toBe(true);
  expect(artifactScrolls({ height: 100, wide: false })).toBe(false);
});

test("only a well-formed probe message is believed", () => {
  expect(parseProbe('{"height":120.2,"wide":true}')).toEqual({ height: 121, wide: true });
  expect(parseProbe('{"height":-1}')).toBeUndefined();
  expect(parseProbe("nope")).toBeUndefined();
});
