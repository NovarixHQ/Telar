import { expect, test } from "bun:test";
import { loadClientId, newClientId, type IdStore } from "./client-id";

const memory = (): IdStore & { saved: Map<string, string> } => {
  const saved = new Map<string, string>();
  return { saved, get: async (key) => saved.get(key) ?? null, set: async (key, value) => void saved.set(key, value) };
};

test("an install keeps the id it made the first time", async () => {
  const store = memory();
  let made = 0;
  const create = () => `ID-${++made}`;
  expect(await loadClientId(store, create)).toBe("ID-1");
  expect(await loadClientId(store, create)).toBe("ID-1");
  expect(made).toBe(1);
});

test("two installs get different ids", async () => {
  expect(await loadClientId(memory())).not.toBe(await loadClientId(memory()));
});

test("the id is an upper-case v4 UUID like Swift's identifierForVendor", () => {
  expect(newClientId()).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  expect(newClientId(() => 0)).toBe("00000000-0000-4000-8000-000000000000");
});
