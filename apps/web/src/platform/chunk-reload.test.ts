import { describe, expect, test } from "bun:test";
import { isChunkLoadError, reloadForNewBuild, reloadIsDue } from "./chunk-reload";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

describe("isChunkLoadError", () => {
  test("recognises webpack, Turbopack and native dynamic-import failures", () => {
    const chunk = new Error("Loading chunk 123 failed.");
    chunk.name = "ChunkLoadError";
    expect(isChunkLoadError(chunk)).toBe(true);
    expect(isChunkLoadError(new Error("Failed to load chunk /_next/static/chunks/abc.js; Loading chunk abc failed"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://x/_next/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
  });

  test("leaves ordinary errors alone", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false);
  });
});

describe("reloadForNewBuild", () => {
  test("a reload is due once, not again inside the guard window, and again after it", () => {
    const storage = memoryStorage();
    let reloads = 0;
    expect(reloadIsDue({ storage, now: 1_000_000 })).toBe(true);
    reloadForNewBuild({ storage, now: 1_000_000, reload: () => void reloads++ });
    expect(reloads).toBe(1);
    expect(reloadIsDue({ storage, now: 1_010_000 })).toBe(false);
    expect(reloadIsDue({ storage, now: 1_040_000 })).toBe(true);
  });
});
