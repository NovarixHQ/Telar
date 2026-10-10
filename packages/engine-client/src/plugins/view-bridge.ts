import { z } from "zod";
import { artifactThemeCss, type ArtifactTheme } from "../agent-tools/artifact-theme";

export const VIEW_BRIDGE_VERSION = 1;

export const ViewRequest = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("read"), path: z.string().min(1).max(1000).optional() }),
  z.strictObject({ op: z.literal("call"), verb: z.string().regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/), input: z.record(z.string(), z.unknown()).optional() }),
  z.strictObject({ op: z.literal("open"), path: z.string().min(1).max(1000), line: z.number().int().positive().optional() }),
  z.strictObject({ op: z.literal("insert"), text: z.string().min(1).max(20_000) }),
  z.strictObject({ op: z.literal("subscribe") }),
]);
export type ViewRequest = z.infer<typeof ViewRequest>;

export const ViewEnvelope = z.strictObject({
  telarView: z.literal(VIEW_BRIDGE_VERSION),
  nonce: z.string().min(16),
  id: z.number().int().nonnegative(),
  request: ViewRequest,
});
export type ViewEnvelope = z.infer<typeof ViewEnvelope>;

export type ViewContext = { plugin: string; view: string; path?: string };

export type ViewHostMessage = { telarView: typeof VIEW_BRIDGE_VERSION } & (
  | { type: "init"; context: ViewContext; theme: ArtifactTheme }
  | { type: "theme"; theme: ArtifactTheme }
  | { type: "reply"; id: number; ok: true; value: unknown }
  | { type: "reply"; id: number; ok: false; error: string }
  | { type: "event"; event: unknown }
);

function viewSdk(version: number, themeCss: (theme: ArtifactTheme) => string): void {
  const scope = window as unknown as { telar?: unknown };
  if (scope.telar) return;
  const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? "";
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = { theme: new Set<(theme: ArtifactTheme) => void>(), event: new Set<(event: unknown) => void>() };
  let next = 0;
  let subscribed = false;
  let ready: (context: ViewContext) => void = () => undefined;
  const context = new Promise<ViewContext>((resolve) => (ready = resolve));
  const sheet = document.createElement("style");
  sheet.nonce = nonce;
  document.head.append(sheet);
  const applyTheme = (theme: ArtifactTheme) => {
    sheet.textContent = themeCss(theme);
    document.documentElement.dataset.scheme = theme.scheme === "dark" ? "dark" : "light";
    for (const listener of listeners.theme) listener(theme);
  };
  const send = (request: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      parent.postMessage({ telarView: version, nonce, id, request }, "*");
    });
  addEventListener("message", (event: MessageEvent) => {
    const data = event.data as ViewHostMessage | null;
    if (event.source !== parent || data?.telarView !== version) return;
    if (data.type === "init") {
      applyTheme(data.theme);
      ready(data.context);
    } else if (data.type === "theme") applyTheme(data.theme);
    else if (data.type === "event") for (const listener of listeners.event) listener(data.event);
    else if (data.type === "reply") {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) waiting?.resolve(data.value);
      else waiting?.reject(new Error(data.error));
    }
  });
  scope.telar = {
    version,
    context: () => context,
    readFile: (path?: string) => send(path === undefined ? { op: "read" } : { op: "read", path }),
    call: (verb: string, input?: Record<string, unknown>) => send(input === undefined ? { op: "call", verb } : { op: "call", verb, input }),
    openFile: (path: string, line?: number) => send(line === undefined ? { op: "open", path } : { op: "open", path, line }),
    insertText: (text: string) => send({ op: "insert", text }),
    onTheme: (listener: (theme: ArtifactTheme) => void) => listeners.theme.add(listener),
    onEvent(listener: (event: unknown) => void) {
      listeners.event.add(listener);
      if (!subscribed) {
        subscribed = true;
        void send({ op: "subscribe" });
      }
    },
  };
}

export const VIEW_SDK_SOURCE = `(${viewSdk.toString()})(${VIEW_BRIDGE_VERSION},${artifactThemeCss.toString()})`;
