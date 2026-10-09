export type Rect = { screenX: number; screenY: number; width: number; height: number };
export type Size = { width: number; height: number };

const DOCKED_SLACK = 1;

/**
 * How far a keyboard frame, already in window coordinates, covers the window's bottom edge.
 * A floating or undocked keyboard covers nothing: it moves over the content instead of pushing it.
 */
export function keyboardOverlap(frame: Rect, window: Size): number {
  const bottom = frame.screenY + frame.height;
  const docked = bottom >= window.height - DOCKED_SLACK;
  const across = frame.screenX < window.width && frame.screenX + frame.width > 0;
  if (!docked || !across || frame.height <= 0) return 0;
  return Math.max(0, Math.min(window.height, window.height - frame.screenY));
}
