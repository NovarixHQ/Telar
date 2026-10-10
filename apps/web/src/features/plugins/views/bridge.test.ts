import { describe, expect, test } from "bun:test";
import { VIEW_BRIDGE_VERSION } from "@telar/engine-client";
import { admit, answer, eventForFrame, type BridgeDeps, type FrameGrant } from "./bridge";

const NONCE = "0123456789abcdef0123456789abcdef";
const frame = {} as Window;
const other = {} as Window;
const envelope = (request: unknown, nonce = NONCE) => ({ telarView: VIEW_BRIDGE_VERSION, nonce, id: 1, request });

const grant: FrameGrant = { plugin: "data-science", nonce: NONCE, path: "work/analysis.ipynb", fileScope: [".csv"], sessionId: "session_1" };

function recorder() {
  const calls: unknown[][] = [];
  const deps: BridgeDeps = {
    readFile: async (...args) => (calls.push(["read", ...args]), { text: "{}" }),
    callVerb: async (...args) => (calls.push(["call", ...args]), { ok: true }),
    openFile: (...args) => void calls.push(["open", ...args]),
    insertText: (...args) => void calls.push(["insert", ...args]),
    subscribe: () => void calls.push(["subscribe"]),
  };
  return { calls, deps };
}

describe("who may speak", () => {
  test("only the frame itself, from its opaque origin, with its nonce", () => {
    const read = envelope({ op: "read" });
    expect(admit({ data: read, origin: "null", source: frame }, frame, NONCE)?.request).toEqual({ op: "read" });
    expect(admit({ data: read, origin: "null", source: other }, frame, NONCE)).toBeUndefined();
    expect(admit({ data: read, origin: "http://localhost", source: frame }, frame, NONCE)).toBeUndefined();
    expect(admit({ data: envelope({ op: "read" }, "f".repeat(32)), origin: "null", source: frame }, frame, NONCE)).toBeUndefined();
    expect(admit({ data: read, origin: "null", source: frame }, null, NONCE)).toBeUndefined();
  });

  test("a message outside the protocol is dropped, not answered", () => {
    expect(admit({ data: envelope({ op: "fetch", url: "https://example.com" }), origin: "null", source: frame }, frame, NONCE)).toBeUndefined();
    expect(admit({ data: { ...envelope({ op: "read" }), telarView: 2 }, origin: "null", source: frame }, frame, NONCE)).toBeUndefined();
    expect(admit({ data: "read", origin: "null", source: frame }, frame, NONCE)).toBeUndefined();
  });
});

describe("what a frame may do", () => {
  test("it calls its own plugin's verbs and no other plugin's, and never the tool verb", async () => {
    const { calls, deps } = recorder();
    await answer({ op: "call", verb: "notebook/read", input: { path: "x.ipynb" } }, grant, deps);
    expect(calls).toEqual([["call", "session_1", "data-science", "notebook/read", { path: "x.ipynb" }]]);
    await expect(answer({ op: "call", verb: "tool", input: { name: "ds_run" } }, grant, deps)).rejects.toThrow("may not call tools");
    expect(calls).toHaveLength(1);
  });

  test("it reads the file it was opened on, and other files only by its plugin's extensions", async () => {
    const { calls, deps } = recorder();
    await answer({ op: "read" }, grant, deps);
    await answer({ op: "read", path: "work/analysis.ipynb" }, grant, deps);
    await answer({ op: "read", path: "./data/rows.CSV" }, grant, deps);
    expect(calls).toEqual([
      ["read", "session_1", "work/analysis.ipynb"],
      ["read", "session_1", "work/analysis.ipynb"],
      ["read", "session_1", "data/rows.CSV"],
    ]);
    await expect(answer({ op: "read", path: "other.ipynb" }, grant, deps)).rejects.toThrow("may not read other.ipynb");
    await expect(answer({ op: "read", path: ".env" }, grant, deps)).rejects.toThrow("may not read .env");
    await expect(answer({ op: "read", path: "../outside/rows.csv" }, grant, deps)).rejects.toThrow("relative to the session's tree");
    await expect(answer({ op: "read", path: "/etc/rows.csv" }, grant, deps)).rejects.toThrow("relative to the session's tree");
    expect(calls).toHaveLength(3);
  });

  test("without a session it can draw but not read or call", async () => {
    const { deps } = recorder();
    const { sessionId: _sessionId, ...sessionless } = grant;
    await expect(answer({ op: "read" }, sessionless, deps)).rejects.toThrow("needs a session");
    await expect(answer({ op: "call", verb: "kernel" }, sessionless, deps)).rejects.toThrow("needs a session");
  });

  test("it opens files inside the tree and inserts into the composer", async () => {
    const { calls, deps } = recorder();
    await answer({ op: "open", path: "src/a.py", line: 3 }, grant, deps);
    await answer({ op: "insert", text: "df.describe()" }, grant, deps);
    await expect(answer({ op: "open", path: "../../etc/passwd" }, grant, deps)).rejects.toThrow("relative to the session's tree");
    expect(calls).toEqual([
      ["open", "src/a.py", 3],
      ["insert", "df.describe()"],
    ]);
  });
});

describe("events", () => {
  test("only the plugin's own, for this frame's session or the whole Mac", () => {
    const base = { type: "plugin.event", at: 1, pluginId: "data-science", data: null } as const;
    const session = { ...base, id: 4, scope: "session", sessionId: "session_1", name: "kernel.state.changed", data: { state: "idle" } } as const;
    expect(eventForFrame(session, "data-science", "session_1")).toEqual({ name: "kernel.state.changed", data: { state: "idle" } });
    expect(eventForFrame({ ...session, sessionId: "session_2" }, "data-science", "session_1")).toBeUndefined();
    expect(eventForFrame({ ...session, pluginId: "latex" }, "data-science", "session_1")).toBeUndefined();
    expect(eventForFrame({ ...base, scope: "project", projectId: "p", name: "x" }, "data-science", "session_1")).toBeUndefined();
    expect(eventForFrame({ ...base, scope: "machine", name: "envs.changed" }, "data-science", undefined)).toEqual({ name: "envs.changed", data: null });
  });
});
