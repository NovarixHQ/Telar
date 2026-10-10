import { ViewEnvelope, type PluginEventFrame, type ViewRequest } from "@telar/engine-client";
import { fileExtension } from "./contributions";

/** What one mounted frame may do: speak with its nonce, read its file and its plugin's extensions, call its plugin. */
export type FrameGrant = { plugin: string; nonce: string; path?: string; fileScope: readonly string[]; sessionId?: string };

export type BridgeDeps = {
  readFile(sessionId: string, path: string): Promise<unknown>;
  callVerb(sessionId: string, plugin: string, verb: string, input: Record<string, unknown>): Promise<unknown>;
  openFile(path: string, line?: number): void;
  insertText(text: string): void;
  subscribe(): void;
};

class BridgeRefusal extends Error {}

/** The frame's own message, or nothing: a sandboxed frame's origin is "null", and only its loaded scripts know the nonce. */
export function admit(event: Pick<MessageEvent, "data" | "origin" | "source">, frame: Window | null | undefined, nonce: string): ViewEnvelope | undefined {
  if (!frame || event.source !== frame || event.origin !== "null") return undefined;
  const parsed = ViewEnvelope.safeParse(event.data);
  return parsed.success && parsed.data.nonce === nonce ? parsed.data : undefined;
}

/** A path inside the session's tree: relative, no `..`, no backslashes. */
function treePath(path: string): string | undefined {
  const parts = path.replace(/^\.\//, "").split("/");
  if (path.startsWith("/") || path.includes("\\") || parts.some((part) => part === ".." || part === "" || part === ".")) return undefined;
  return parts.join("/");
}

function readablePath(grant: FrameGrant, requested: string | undefined): string {
  if (requested === undefined) {
    if (!grant.path) throw new BridgeRefusal("this view was not opened on a file");
    return grant.path;
  }
  const path = treePath(requested);
  if (!path) throw new BridgeRefusal("a path is relative to the session's tree");
  if (path !== grant.path && !grant.fileScope.includes(fileExtension(path))) throw new BridgeRefusal(`${grant.plugin} may not read ${path}`);
  return path;
}

const needSession = (grant: FrameGrant): string => {
  if (!grant.sessionId) throw new BridgeRefusal("this view needs a session");
  return grant.sessionId;
};

export async function answer(request: ViewRequest, grant: FrameGrant, deps: BridgeDeps): Promise<unknown> {
  switch (request.op) {
    case "read":
      return deps.readFile(needSession(grant), readablePath(grant, request.path));
    case "call":
      // The tool verb is how agents reach a plugin's tools, behind their approval cards; a frame does not get it.
      if (request.verb === "tool") throw new BridgeRefusal("a view may not call tools");
      return deps.callVerb(needSession(grant), grant.plugin, request.verb, request.input ?? {});
    case "open": {
      const path = treePath(request.path);
      if (!path) throw new BridgeRefusal("a path is relative to the session's tree");
      deps.openFile(path, request.line);
      return {};
    }
    case "insert":
      deps.insertText(request.text);
      return {};
    case "subscribe":
      deps.subscribe();
      return {};
  }
}

/** The plugin's own event, for this frame's session, its project or the whole Mac, as the frame sees it. */
export function eventForFrame(frame: PluginEventFrame, plugin: string, sessionId: string | undefined, projectId?: string): { name: string; data: unknown } | undefined {
  if (frame.pluginId !== plugin) return undefined;
  if (frame.scope === "project" && frame.projectId !== projectId) return undefined;
  if (frame.scope === "session" && frame.sessionId !== sessionId) return undefined;
  return { name: frame.name, data: frame.data };
}
