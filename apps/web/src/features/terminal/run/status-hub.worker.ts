import { createStatusHub, followRunStatus, servePort } from "./status-hub";

const hub = createStatusHub(followRunStatus());

(globalThis as unknown as { onconnect: (event: MessageEvent) => void }).onconnect = (event) => servePort(hub, event.ports[0]!);
