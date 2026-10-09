import { expect, test } from "bun:test";
import { HostConnection } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { readFileDraft, writeFile, writeFileDraft } from "./save";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const FILE = { path: "src/app.ts", text: "next", bytes: 4, sha256: "sha-next", binary: false, truncated: false };

async function online(answer: () => Response) {
  const writes: { method: string; url: string; body: unknown }[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      writes.push({ method: init.method ?? "GET", url: network.seen.at(-1)!.url, body: JSON.parse(String(init.body)) });
      return answer();
    },
  });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock() });
  host.start();
  await until(host, "online");
  return { host, writes };
}

test("a save puts the whole text with the hash it was edited from", async () => {
  const { host, writes } = await online(() => Response.json({ written: true, file: FILE }));
  const result = await writeFile(host, "s1", "src/app.ts", "next", "sha-before");
  expect(writes).toEqual([{ method: "PUT", url: `${MAC}/api/sessions/s1/files?path=src%2Fapp.ts`, body: { text: "next", expectedSha256: "sha-before" } }]);
  expect(result).toEqual({ written: true, file: FILE });
});

test("a file the agent changed meanwhile comes back as a conflict, not a write", async () => {
  const { host } = await online(() => Response.json({ written: false, refusal: "conflict", sha256: "sha-agent" }));
  expect(await writeFile(host, "s1", "src/app.ts", "mine", "sha-before")).toEqual({ written: false, refusal: "conflict", sha256: "sha-agent" });
});

test("an unsaved draft survives in the phone's settings until it is cleared", () => {
  const saved = new Map<string, string>();
  const store = { get: (key: string) => saved.get(key), set: (values: Record<string, string>) => Object.entries(values).forEach(([key, value]) => saved.set(key, value)) };
  writeFileDraft(store, "h", "s1", "a.md", { text: "draft", baseline: "sha" });
  expect(readFileDraft(store, "h", "s1", "a.md")).toEqual({ text: "draft", baseline: "sha" });
  expect(readFileDraft(store, "h", "s2", "a.md")).toBeUndefined();
  writeFileDraft(store, "h", "s1", "a.md", undefined);
  expect(readFileDraft(store, "h", "s1", "a.md")).toBeUndefined();
});
