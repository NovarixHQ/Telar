import { parsePairingUrl } from "@telar/engine-client";

export type Scan = "accept" | "reject" | "ignore";

/** Takes the first pairing link the camera sees; any other code is refused once and then ignored, so the warning doesn't flicker. */
export function scanGate(isPairingLink: (payload: string) => boolean = (payload) => parsePairingUrl(payload) !== undefined): (payload: string) => Scan {
  let accepted = false;
  const refused = new Set<string>();
  return (payload) => {
    if (accepted || refused.has(payload)) return "ignore";
    if (isPairingLink(payload)) {
      accepted = true;
      return "accept";
    }
    refused.add(payload);
    return "reject";
  };
}

// expo-camera zooms on a 0–1 log scale of the lens's own range, which it does not report; this keeps the pinch near Swift's 8× cap.
const MAX_ZOOM = 0.45;

/** The camera zoom after a pinch that started at `start` and has spread by `scale`. */
export function pinchZoom(start: number, scale: number): number {
  if (!(scale > 0)) return start;
  return Math.min(MAX_ZOOM, Math.max(0, start + Math.log(scale) / 5));
}

type Touch = { pageX: number; pageY: number };

export const touchSpread = (touches: readonly Touch[]): number | undefined => {
  const [a, b] = touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : undefined;
};
