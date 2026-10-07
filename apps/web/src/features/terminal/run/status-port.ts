import { createStatusHub, followRunStatus, type HubListener, type HubSignal, type PortReply, type PortRequest, type RunStatusSource } from "./status-hub";

/** The window side. `detach`/`reattach` cover page unload and a page restored from the back-forward cache. */
export function portSource(port: MessagePort): RunStatusSource & { detach: () => void; reattach: () => void } {
  let next = 0;
  const subscriptions = new Map<number, { path: string; listener: HubListener }>();
  port.onmessage = ({ data }: MessageEvent<PortReply>) => {
    const { id, ...signal } = data;
    subscriptions.get(id)?.listener(signal as HubSignal);
  };
  const send = (request: PortRequest) => port.postMessage(request);
  return {
    subscribe(path, listener) {
      const id = next++;
      subscriptions.set(id, { path, listener });
      send({ type: "subscribe", id, path });
      return () => {
        if (subscriptions.delete(id)) send({ type: "unsubscribe", id });
      };
    },
    detach: () => send({ type: "bye" }),
    reattach: () => {
      for (const [id, { path }] of subscriptions) send({ type: "subscribe", id, path });
    },
  };
}

let source: RunStatusSource | undefined;

/** Every window shares one SharedWorker, so a session's feed is one connection app-wide; without one, it is one per window. */
export function runStatusSource(): RunStatusSource {
  source ??= sharedSource() ?? createStatusHub(followRunStatus());
  return source;
}

function sharedSource(): RunStatusSource | undefined {
  if (typeof SharedWorker === "undefined") return undefined;
  try {
    const worker = new SharedWorker(new URL("./status-hub.worker.ts", import.meta.url), { name: "telar-run-status" });
    const shared = portSource(worker.port);
    window.addEventListener("pagehide", () => shared.detach());
    window.addEventListener("pageshow", (event) => event.persisted && shared.reattach());
    return shared;
  } catch {
    return undefined;
  }
}
