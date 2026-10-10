export type Permission = "accessibility";
export type Permissions = Record<Permission, boolean>;


export type FrontContext = {
  app: string;
  title: string;
  selection: string;
  permissions: Permissions;
  grantee: string;
  fresh?: boolean;
};

export type QuickComposerBridge = {
  context: () => Promise<FrontContext | null>;
  onOpen: (listener: (context: FrontContext) => void) => () => void;
  close: () => Promise<unknown>;
  mode: (mode: "compact" | "expanded") => void;
  onMoved: (listener: () => void) => () => void;
  sent: (input: { route: string; title: string; detail: string; open: boolean }) => Promise<unknown>;
  hold: () => void;
  failed: (message: string) => void;
  onPermissions: (listener: (permissions: Permissions) => void) => () => void;
  openSettings: (permission: Permission) => Promise<unknown>;
};

export function quickComposerBridge(): QuickComposerBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { telarDesktop?: { quickComposer?: QuickComposerBridge } }).telarDesktop?.quickComposer;
}

export type ContextOffer = { id: "selection"; label: string; file: File };

export function contextOffers(context: FrontContext | null): ContextOffer[] {
  if (!context) return [];
  const offers: ContextOffer[] = [];
  if (context.selection.trim()) offers.push({ id: "selection", label: "Attach selected text", file: new File([context.selection], "Selected text.txt", { type: "text/plain" }) });
  return offers;
}

export function missingPermissions(context: FrontContext | null): boolean {
  return Boolean(context && !context.permissions.accessibility);
}
