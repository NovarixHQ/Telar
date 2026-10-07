"use client";

import { useEffect, useState } from "react";

const sources = new Map<string, Promise<string>>();
const built = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, "$2");

const firstFamily = (stack: string | undefined): string => unquote(stack?.split(",")[0] ?? "");

function rangeCovers(range: string, point: number): boolean {
  if (!range.trim()) return true;
  return range.split(",").some((part) => {
    const match = /^u\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i.exec(part.trim());
    if (!match) return false;
    const low = Number.parseInt(match[1]!.replaceAll("?", "0"), 16);
    const high = Number.parseInt(match[2] ?? match[1]!.replaceAll("?", "f"), 16);
    return point >= low && point <= high;
  });
}

// Only the Latin subset of each face, so a frame carries tens of kilobytes rather than every script the font ships.
function faceRules(families: Set<string>): CSSFontFaceRule[] {
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of document.styleSheets) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of list) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      if (families.has(unquote(rule.style.getPropertyValue("font-family"))) && rangeCovers(rule.style.getPropertyValue("unicode-range"), 0x41)) rules.push(rule);
    }
  }
  return rules;
}

function dataUrl(url: string): Promise<string> {
  let source = sources.get(url);
  if (!source) {
    source = fetch(url)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`${response.status}`))))
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }));
    source.catch(() => sources.delete(url));
    sources.set(url, source);
  }
  return source;
}

const DESCRIPTORS = ["font-style", "font-weight", "font-stretch", "font-display", "unicode-range"];

async function faceCss(rule: CSSFontFaceRule): Promise<string> {
  const src = /url\((['"]?)([^'")]+)\1\)/.exec(rule.style.getPropertyValue("src"))?.[2];
  if (!src) return "";
  const data = await dataUrl(new URL(src, rule.parentStyleSheet?.href ?? document.baseURI).href).catch(() => undefined);
  if (!data?.startsWith("data:")) return "";
  const family = unquote(rule.style.getPropertyValue("font-family")).replaceAll('"', "");
  const descriptors = DESCRIPTORS.map((name) => [name, rule.style.getPropertyValue(name).replace(/[;{}<]/g, "")]).filter(([, value]) => value);
  return `@font-face{font-family:"${family}";src:url(${data})${descriptors.map(([name, value]) => `;${name}:${value}`).join("")}}`;
}

/** @font-face rules with data: sources for the families that open these stacks, fetched once and cached. */
export function fontFaceCss(stacks: Array<string | undefined>): Promise<string> {
  const families = [...new Set(stacks.map(firstFamily).filter(Boolean))];
  const key = families.join("|");
  let css = built.get(key);
  if (!css) {
    css = Promise.all(faceRules(new Set(families)).map(faceCss)).then((faces) => faces.join(""));
    css.then((value) => (value ? ready.set(key, value) : built.delete(key)), () => built.delete(key));
    built.set(key, css);
  }
  return css;
}

export function useFontFaces(stacks: Array<string | undefined>): string | undefined {
  const key = [...new Set(stacks.map(firstFamily).filter(Boolean))].join("|");
  const [loaded, setLoaded] = useState<{ key: string; css: string }>();
  useEffect(() => {
    let live = true;
    void fontFaceCss(key.split("|")).then((css) => live && setLoaded({ key, css }), () => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return (loaded?.key === key ? loaded.css : ready.get(key)) || undefined;
}
