type Route = { key: string; name: string };
type Stack = { routes: Route[]; index: number };
type Action = { type: string; source?: string; payload?: object };

export const SIDEBAR_WIDTH = 300;

/** UIKit's horizontal size class from the window width: iPads below a half split and iPhones short of a Max in landscape are compact. */
export function isRegularWidth(width: number, pad: boolean): boolean {
  return width >= (pad ? 640 : 880);
}

/** Choosing a selection route from the sidebar replaces the detail column instead of stacking on it, as a split view's selection does. */
export function selectionBase<S extends Stack>(state: S, action: Action, selection: readonly string[]): S {
  const root = state.routes[0];
  const name = action.payload && "name" in action.payload ? action.payload.name : undefined;
  const fromSidebar = root !== undefined && action.source === root.key && (action.type === "NAVIGATE" || action.type === "PUSH");
  if (!fromSidebar || typeof name !== "string" || !selection.includes(name)) return state;
  return { ...state, routes: [root], index: 0 };
}

/** The stack cut into what the sidebar shows (its root) and what the detail column shows (everything above it). */
export function splitColumns<S extends Stack>(state: S): { sidebar: S; detail: S | undefined } {
  const [root, ...rest] = state.routes;
  const sidebar = { ...state, routes: root ? [root] : [], index: 0 };
  return { sidebar, detail: rest.length ? { ...state, routes: rest, index: Math.max(0, state.index - 1) } : undefined };
}
