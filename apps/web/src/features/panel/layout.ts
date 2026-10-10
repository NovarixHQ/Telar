export const RIGHT_PANEL_WIDTH_STORAGE_KEY = "right-panel";
export const RIGHT_PANEL_DEFAULT_WIDTH = 480;
export const RIGHT_PANEL_MIN_WIDTH = 384;

/** For surfaces whose content sets their width (a notebook, a file beside its tree). */
export const RIGHT_PANEL_WIDE_DEFAULT_WIDTH = 720;

/** Only a default, behind a stored width; an Editor anywhere in the strip decides so switching tabs never jumps. */
export function defaultRightPanelWidth(tabs: readonly { kind: string }[]): number {
  return tabs.some((tab) => tab.kind === "editor") ? RIGHT_PANEL_WIDE_DEFAULT_WIDTH : RIGHT_PANEL_DEFAULT_WIDTH;
}

/** Bounds both the drag and the CSS `max-width` the panel carries when the window shrinks. */
export const RIGHT_PANEL_MAIN_MIN_WIDTH = 384;
