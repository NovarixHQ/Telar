import type { BrowserInput, BrowserStreamEvent, BrowserTab } from "@telar/engine-client";
import type { CdpConnection } from "./cdp";

type Target = { targetId: string; type: string; url: string; title: string };
type Listener = (event: BrowserStreamEvent) => void;

const BUTTONS = { left: 1, right: 2, middle: 4 } as const;
const MOUSE_TYPE = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;
const FRAME_INTERVAL_MS = 80;

function webUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http and https pages can be opened");
  return url.href;
}

export class BrowserScreencast {
  private readonly pages = new Map<string, Target>();
  private readonly listeners = new Set<Listener>();
  private viewed: string | null = null;
  private cdpSession: string | null = null;
  private lastFrameAt = 0;
  private size = { width: 1280, height: 800 };
  private ready: Promise<void> | null = null;

  constructor(private readonly cdp: CdpConnection) {
    cdp.on("Target.targetCreated", (params) => this.seen((params.targetInfo as Target) ?? {}));
    cdp.on("Target.targetInfoChanged", (params) => this.seen((params.targetInfo as Target) ?? {}));
    cdp.on("Target.targetDestroyed", (params) => void this.gone(String(params.targetId)));
    cdp.on("Page.screencastFrame", (params, sessionId) => this.frame(params, sessionId));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.begin().then(() => listener({ type: "tabs", tabs: this.tabs() })).catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
    };
  }

  tabs(): BrowserTab[] {
    return [...this.pages.values()].map((page, index) => ({ id: page.targetId, url: page.url, title: page.title || (index === 0 ? "" : page.url), active: page.targetId === this.viewed }));
  }

  private begin(): Promise<void> {
    this.ready ??= (async () => {
      await this.cdp.send("Target.setDiscoverTargets", { discover: true });
      const first = [...this.pages.keys()][0] ?? (await this.cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
      if (!this.viewed) await this.view(first);
    })().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private emit(event: BrowserStreamEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private seen(info: Partial<Target>): void {
    if (info.type !== "page" || !info.targetId) return;
    this.pages.set(info.targetId, { targetId: info.targetId, type: "page", url: info.url ?? "", title: info.title ?? "" });
    this.emit({ type: "tabs", tabs: this.tabs() });
  }

  private async gone(targetId: string): Promise<void> {
    if (!this.pages.delete(targetId)) return;
    if (this.viewed === targetId) {
      this.viewed = null;
      this.cdpSession = null;
      const next = [...this.pages.keys()][0];
      if (next) await this.view(next).catch(() => undefined);
      else await this.cdp.send("Target.createTarget", { url: "about:blank" }).catch(() => undefined);
    }
    this.emit({ type: "tabs", tabs: this.tabs() });
  }

  private async view(targetId: string): Promise<void> {
    if (this.cdpSession) await this.cdp.send("Page.stopScreencast", {}, this.cdpSession).catch(() => undefined);
    const { sessionId } = await this.cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    this.viewed = targetId;
    this.cdpSession = sessionId;
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { ...this.size, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1 }, sessionId);
    this.emit({ type: "tabs", tabs: this.tabs() });
  }

  private frame(params: Record<string, unknown>, sessionId: string | undefined): void {
    if (!sessionId) return;
    void this.cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId).catch(() => undefined);
    const now = Date.now();
    if (sessionId !== this.cdpSession || now - this.lastFrameAt < FRAME_INTERVAL_MS || this.listeners.size === 0) return;
    this.lastFrameAt = now;
    this.emit({ type: "frame", tabId: this.viewed ?? "", data: String(params.data), width: this.size.width, height: this.size.height });
  }

  async input(input: BrowserInput): Promise<void> {
    await this.begin();
    const session = this.cdpSession;
    if (!session) throw new Error("There is no page to send that to.");
    const send = (method: string, params: Record<string, unknown>) => this.cdp.send(method, params, session);
    switch (input.type) {
      case "mouse":
        await send("Input.dispatchMouseEvent", { type: MOUSE_TYPE[input.action], x: input.x, y: input.y, button: input.action === "move" ? "none" : input.button, buttons: input.action === "up" ? 0 : BUTTONS[input.button], clickCount: input.action === "move" ? 0 : input.clickCount, modifiers: input.modifiers });
        return;
      case "wheel":
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY });
        return;
      case "key": {
        const text = input.action === "down" ? input.text : undefined;
        await send("Input.dispatchKeyEvent", { type: input.action === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown", key: input.key, code: input.code, modifiers: input.modifiers, ...(text ? { text } : {}), ...(input.keyCode ? { windowsVirtualKeyCode: input.keyCode } : {}) });
        return;
      }
      case "text":
        await send("Input.insertText", { text: input.text });
        return;
      case "resize":
        this.size = { width: input.width, height: input.height };
        await send("Emulation.setDeviceMetricsOverride", { ...this.size, deviceScaleFactor: 1, mobile: false });
        await send("Page.stopScreencast", {});
        await send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: input.width, maxHeight: input.height, everyNthFrame: 1 });
        return;
      case "navigate":
        await send("Page.navigate", { url: webUrl(input.url) });
        return;
      case "history":
        await this.history(session, input.action);
        return;
      case "tab":
        await this.tab(input);
    }
  }

  private async history(session: string, action: "back" | "forward" | "reload"): Promise<void> {
    if (action === "reload") {
      await this.cdp.send("Page.reload", {}, session);
      return;
    }
    const { currentIndex, entries } = await this.cdp.send<{ currentIndex: number; entries: { id: number }[] }>("Page.getNavigationHistory", {}, session);
    const entry = entries[currentIndex + (action === "back" ? -1 : 1)];
    if (entry) await this.cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, session);
  }

  private async tab(input: Extract<BrowserInput, { type: "tab" }>): Promise<void> {
    if (input.action === "new") {
      const { targetId } = await this.cdp.send<{ targetId: string }>("Target.createTarget", { url: input.url ? webUrl(input.url) : "about:blank" });
      await this.view(targetId);
      return;
    }
    const targetId = input.tabId ?? this.viewed;
    if (!targetId || !this.pages.has(targetId)) throw new Error("That tab is gone.");
    if (input.action === "close") await this.cdp.send("Target.closeTarget", { targetId });
    else {
      await this.cdp.send("Target.activateTarget", { targetId });
      await this.view(targetId);
    }
  }
}
