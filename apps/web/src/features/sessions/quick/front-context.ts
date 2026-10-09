export type Permission = "accessibility" | "screen";
export type Permissions = Record<Permission, boolean>;

export type FrontContext = {
  app: string;
  title: string;
  selection: string;
  screenshot: string | null;
  permissions: Permissions;
  grantee: string;
};

export type QuickComposerBridge = {
  context: () => Promise<FrontContext | null>;
  onOpen: (listener: (context: FrontContext) => void) => () => void;
  close: () => Promise<unknown>;
  resize: (height: number, anchor: number) => void;
  sent: (input: { route: string; title: string; detail: string; open: boolean }) => Promise<unknown>;
  hold: () => void;
  drag: (input: { phase: "start"; offsetX: number; offsetY: number } | { phase: "end" }) => void;
  onPermissions: (listener: (permissions: Permissions) => void) => () => void;
  openSettings: (permission: Permission) => Promise<unknown>;
};

export function quickComposerBridge(): QuickComposerBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { telarDesktop?: { quickComposer?: QuickComposerBridge } }).telarDesktop?.quickComposer;
}

function fileName(context: FrontContext): string {
  const label = [context.app, context.title].filter(Boolean).join(" · ") || "Window";
  return `${label.replace(/[\\/:]/g, "-").slice(0, 80)}.png`;
}

function pngFrom(dataUrl: string, name: string): File {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

export type ContextOffer = { id: "window" | "selection"; label: string; file: File };

export function contextOffers(context: FrontContext | null): ContextOffer[] {
  if (!context) return [];
  const offers: ContextOffer[] = [];
  if (context.screenshot?.startsWith("data:image/png;base64,")) offers.push({ id: "window", label: `Attach ${context.title || context.app || "window"}`, file: pngFrom(context.screenshot, fileName(context)) });
  if (context.selection.trim()) offers.push({ id: "selection", label: "Attach selected text", file: new File([context.selection], "Selected text.txt", { type: "text/plain" }) });
  return offers;
}

export function missingPermissions(context: FrontContext | null): boolean {
  return Boolean(context && (!context.permissions.accessibility || !context.permissions.screen));
}
