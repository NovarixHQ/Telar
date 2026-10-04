"use client";

import { createEngineApi, headBytes, INITIAL_TURNS, projectJournal, sessionConnection, type HydratedSession, type SessionConnection } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";

/** A session's newest turns, folded through `cursor`, as it was when saved. */
type StoredHead = HydratedSession & { savedAt: number };
type HeadMeta = { savedAt: number; bytes: number };

export interface HeadStore {
  read(key: string): Promise<StoredHead | undefined>;
  write(key: string, head: StoredHead, meta: HeadMeta): Promise<void>;
  remove(keys: string[]): Promise<void>;
  index(): Promise<Map<string, HeadMeta>>;
}

export const HEADS_ON_DISK = 30;
export const HEAD_BYTES = 1_000_000;
export const HEADS_TOTAL_BYTES = 20_000_000;

export function headKey(hostId: string, sessionId: string): string {
  return `${hostId}:${sessionId}`;
}

export function headConnection(hostId: string, sessionId: string): SessionConnection {
  return sessionConnection(hostId, createEngineApi(hostFetcher(hostId)), sessionId, { turns: INITIAL_TURNS });
}

/** Folds the journal into the items so the saved head carries no events, only a cursor to resume from. */
function foldHead(head: HydratedSession): HydratedSession {
  if (!head.events.length) return head;
  const items = projectJournal(head.turns, head.items, head.events, head.tasks)
    .flatMap((turn) => [...turn.items, ...turn.tasks.flatMap((task) => task.items)])
    .map((item) => ({ ...item, streamed: item.streamedText, streamedThrough: head.cursor }));
  return { ...head, items, events: [] };
}

/** Least recently saved go first, past the count or the total; a head over its own cap is not kept at all. */
export async function saveHead(store: HeadStore, key: string, head: HydratedSession, now = Date.now()): Promise<void> {
  const stored: StoredHead = { ...foldHead(head), savedAt: now };
  const bytes = headBytes(stored);
  if (bytes > HEAD_BYTES) return store.remove([key]);
  await store.write(key, stored, { savedAt: now, bytes });
  const newest = [...(await store.index())].sort((left, right) => right[1].savedAt - left[1].savedAt);
  let total = 0;
  const evicted = newest.filter(([, meta], rank) => (total += meta.bytes) > HEADS_TOTAL_BYTES || rank >= HEADS_ON_DISK);
  if (evicted.length) await store.remove(evicted.map(([evictedKey]) => evictedKey));
}

/** Memory first, then disk, then the network: the head the caller can paint now, and the reconciled one. */
export function openHead(hostId: string, sessionId: string, store = headStore()): { held?: Promise<HydratedSession | undefined>; reconciled: Promise<HydratedSession> } {
  const connection = headConnection(hostId, sessionId);
  if (connection.peek() || !store) return { reconciled: connection.open() };
  const held = store
    .read(headKey(hostId, sessionId))
    .catch(() => undefined)
    .then((stored) => {
      if (stored) connection.seed(stored, stored.savedAt);
      return connection.peek();
    });
  return { held, reconciled: held.then(() => connection.open()) };
}

export function forgetHostHeads(hostId: string, store = headStore()): Promise<void> {
  if (!store) return Promise.resolve();
  return store.index().then((index) => store.remove([...index.keys()].filter((key) => key.startsWith(`${hostId}:`))));
}

export function memoryHeadStore(): HeadStore {
  const heads = new Map<string, StoredHead>();
  const metas = new Map<string, HeadMeta>();
  return {
    read: async (key) => heads.get(key),
    async write(key, head, meta) {
      heads.set(key, head);
      metas.set(key, meta);
    },
    async remove(keys) {
      for (const key of keys) {
        heads.delete(key);
        metas.delete(key);
      }
    },
    index: async () => new Map(metas),
  };
}

const DB_NAME = "telar-heads";
const HEADS = "heads";
const META = "meta";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of [HEADS, META]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** `work` queues requests on the transaction and returns how to read the answer once it commits. */
function transact<T>(mode: IDBTransactionMode, work: (heads: IDBObjectStore, meta: IDBObjectStore) => () => T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction([HEADS, META], mode);
        const answer = work(tx.objectStore(HEADS), tx.objectStore(META));
        tx.oncomplete = () => {
          db.close();
          resolve(answer());
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

const nothing = () => undefined;

function browserHeadStore(): HeadStore | undefined {
  if (typeof indexedDB === "undefined") return undefined;
  indexedDB.deleteDatabase("telar-snapshots");
  return {
    read: (key) =>
      transact("readonly", (heads) => {
        const request = heads.get(key) as IDBRequest<StoredHead | undefined>;
        return () => request.result;
      }),
    write: (key, head, meta) =>
      transact("readwrite", (heads, metas) => {
        heads.put(head, key);
        metas.put(meta, key);
        return nothing;
      }),
    remove: (keys) =>
      transact("readwrite", (heads, metas) => {
        for (const key of keys) {
          heads.delete(key);
          metas.delete(key);
        }
        return nothing;
      }),
    index: () =>
      transact("readonly", (_heads, metas) => {
        const index = new Map<string, HeadMeta>();
        const cursor = metas.openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          index.set(String(cursor.result.key), cursor.result.value as HeadMeta);
          cursor.result.continue();
        };
        return () => index;
      }),
  };
}

let shared: HeadStore | undefined | null = null;
export function headStore(): HeadStore | undefined {
  if (shared === null) shared = browserHeadStore();
  return shared;
}

/** Tests: stand in for IndexedDB. */
export function setHeadStore(store: HeadStore | undefined): void {
  shared = store;
}
