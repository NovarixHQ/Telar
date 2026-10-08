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

/** The stack cut into the sidebar (its root plus sheets opened over it) and the detail column (the first pushed screen up).
 *  A sheet stays in the stack that presented it, so it covers the window instead of becoming the detail column's root. */
export function splitColumns<S extends Stack>(state: S, isSheet: (route: S["routes"][number]) => boolean): { sidebar: S; detail: S | undefined } {
  const pushed = state.routes.findIndex((route, index) => index > 0 && !isSheet(route));
  const cut = pushed === -1 ? state.routes.length : pushed;
  const sidebar = { ...state, routes: state.routes.slice(0, cut), index: Math.min(state.index, cut - 1) };
  return { sidebar, detail: pushed === -1 ? undefined : { ...state, routes: state.routes.slice(cut), index: Math.max(0, state.index - cut) } };
}
