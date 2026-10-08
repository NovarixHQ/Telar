export const PANEL_WIDTH_KEY = "telar.panel.width";
const PANEL_IDEAL = 440;

const MIN = 320;
const MAX = 720;
const CHAT_FLOOR = 560;
const SIDEBAR = 300;
const READING = 680;

export function clampPanelWidth(width: number, total: number): number {
  const max = Math.max(MIN, Math.min(MAX, total - CHAT_FLOOR));
  return Math.min(Math.max(Number.isFinite(width) ? width : PANEL_IDEAL, MIN), max);
}

export const panelWidthOf = (stored: unknown): number => (typeof stored === "number" && Number.isFinite(stored) ? stored : PANEL_IDEAL);

export function standsAside(open: boolean, full: boolean, window: number, panel: number): boolean {
  return open && (full || window < SIDEBAR + READING + clampPanelWidth(panel, window));
}
