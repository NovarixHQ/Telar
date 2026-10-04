import { describe, expect, test } from "bun:test";
import type { HydratedSession } from "@/platform/engine";
import { envelope, item, turn } from "@/test/journal-fixtures";
import { forgetHostHeads, HEAD_BYTES, HEADS_ON_DISK, HEADS_TOTAL_BYTES, headKey, memoryHeadStore, saveHead } from "./session-heads";

const head = (id: string, padding = 0): HydratedSession =>
  ({ session: { id, title: "x".repeat(padding) }, turns: [], items: [], tasks: [], requests: [], events: [], cursor: 1 }) as unknown as HydratedSession;

describe("heads saved to disk", () => {
  test("keep the 30 most recently saved", async () => {
    const store = memoryHeadStore();
    for (let index = 0; index < HEADS_ON_DISK + 5; index += 1) await saveHead(store, headKey("local", `s${index}`), head(`s${index}`), 100 + index);
    const kept = [...(await store.index()).keys()];
    expect(kept).toHaveLength(HEADS_ON_DISK);
    expect(kept).not.toContain("local:s4");
    expect(kept).toContain("local:s5");
  });

  test("drop the oldest once the total passes the byte cap", async () => {
    const store = memoryHeadStore();
    const share = Math.floor(HEAD_BYTES * 0.9);
    const fit = Math.floor(HEADS_TOTAL_BYTES / share);
    for (let index = 0; index <= fit; index += 1) await saveHead(store, headKey("local", `s${index}`), head(`s${index}`, share), index);
    const index = await store.index();
    expect(index.size).toBe(fit);
    expect(index.has("local:s0")).toBe(false);
    expect([...index.values()].reduce((sum, meta) => sum + meta.bytes, 0)).toBeLessThanOrEqual(HEADS_TOTAL_BYTES);
  });

  test("a head over its own cap is not kept, and replaces an older copy", async () => {
    const store = memoryHeadStore();
    await saveHead(store, "local:s1", head("s1"), 1);
    await saveHead(store, "local:s1", head("s1", HEAD_BYTES), 2);
    expect(await store.read("local:s1")).toBeUndefined();
  });

  test("are saved folded, with the cursor to resume from", async () => {
    const store = memoryHeadStore();
    const streaming: HydratedSession = {
      ...head("s1"),
      turns: [turn],
      cursor: 2,
      events: [
        { ...envelope, id: 1, type: "item.started", item: item({ id: "i1", detail: { type: "assistant_message", text: "" } }) },
        { ...envelope, id: 2, type: "content.delta", itemId: "i1", stream: "assistant_text", text: "Hel" },
      ],
    };
    await saveHead(store, "local:s1", streaming, 1);
    const saved = await store.read("local:s1");
    expect(saved?.events).toEqual([]);
    expect(saved?.cursor).toBe(2);
    expect(saved?.items.map((entry) => [entry.id, entry.streamed, entry.streamedThrough])).toEqual([["i1", "Hel", 2]]);
  });

  test("forgetting a host removes only its heads", async () => {
    const store = memoryHeadStore();
    await saveHead(store, headKey("host_a", "s1"), head("s1"), 1);
    await saveHead(store, headKey("local", "s1"), head("s1"), 2);
    await forgetHostHeads("host_a", store);
    expect([...(await store.index()).keys()]).toEqual(["local:s1"]);
  });
});
