"use client";

import { useEffect, useState, type ReactNode } from "react";
import { normalizeChord } from "../commands";

export type ChordClaim =
  | { chord: string; outcome: "claimed" }
  | { chord: string; outcome: "portal" }
  | { chord: string; outcome: "unavailable"; reason: "taken" | "desktop"; command?: string };

type ClaimBridge = {
  claim?: () => Promise<ChordClaim | null>;
  onClaim?: (listener: (claim: ChordClaim | null) => void) => () => void;
};

function bridge(): ClaimBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { telarDesktop?: { keybindings?: ClaimBridge } }).telarDesktop?.keybindings;
}

export function useChordClaim(): ChordClaim | null {
  const [claim, setClaim] = useState<ChordClaim | null>(null);
  useEffect(() => {
    const shell = bridge();
    let live = true;
    shell?.claim?.().then((first) => live && setClaim(first ?? null), () => undefined);
    const stop = shell?.onClaim?.((next) => setClaim(next ?? null));
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return claim;
}

const Command = ({ command }: { command: string }) => <code className="rounded bg-muted px-1 font-mono text-2xs">{command}</code>;

export function chordClaimCopy(claim: ChordClaim | null, chord: string): { hint: ReactNode; info?: ReactNode } | null {
  if (!claim || !chord || normalizeChord(claim.chord) !== normalizeChord(chord)) return null;
  if (claim.outcome === "claimed") return null;
  if (claim.outcome === "portal") {
    return {
      hint: "Your desktop asks to allow this chord the first time, then keeps it in its own keyboard settings.",
      info: "The desktop has the last word here: it can change the keys or turn the chord off.",
    };
  }
  if (claim.reason === "taken") {
    return {
      hint: "Another app already holds this chord, so pick another.",
      ...(claim.command ? { info: <>Or add a shortcut in your desktop’s keyboard settings that runs <Command command={claim.command} />.</> } : {}),
    };
  }
  const command = claim.command ?? "telar --quick-composer";
  return {
    hint: (
      <>
        This desktop doesn’t let apps claim chords, so bind one to <Command command={command} /> in its keyboard settings.
      </>
    ),
    info: "That command opens the Quick Composer in the running app, and starts the app first if it isn’t running.",
  };
}
