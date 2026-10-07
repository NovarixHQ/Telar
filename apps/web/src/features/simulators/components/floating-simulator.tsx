"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/ui/utils";
import { createSimulatorsApi, type SimulatorsApi } from "../api";
import { dockSimulator, dragFloat, floatKey, keepFloatSpot, placeFloat, resizeFloat, useSimulatorFloat, type Corner, type FloatFrame } from "../float";
import { useBox } from "../hooks/use-box";
import { SimulatorView } from "./simulator-view";

const PHONE_ASPECT = 0.48;
const CORNERS: Record<Corner, string> = {
  nw: "top-0 left-0 cursor-nwse-resize",
  ne: "top-0 right-0 cursor-nesw-resize",
  sw: "bottom-0 left-0 cursor-nesw-resize",
  se: "bottom-0 right-0 cursor-nwse-resize",
};

type Gesture = { pointerId: number; from: { x: number; y: number }; start: FloatFrame; corner: Corner | undefined };

type Props = { sessionId: string; hostId?: string; onOpenInPanel: (simulatorId: string) => void; api?: SimulatorsApi };

export function FloatingSimulator({ sessionId, hostId, onOpenInPanel, api: injected }: Props) {
  const key = floatKey(hostId, sessionId);
  const { simulator, spot } = useSimulatorFloat(key);
  const api = useMemo(() => injected ?? createSimulatorsApi(hostId), [injected, hostId]);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const room = useBox(layer);
  const [aspect, setAspect] = useState(PHONE_ASPECT);
  const [moving, setMoving] = useState<FloatFrame>();
  const gesture = useRef<Gesture>(undefined);
  if (!simulator) return null;

  const frame = moving ?? placeFloat(spot, aspect, room);
  const close = () => dockSimulator(key);
  const dock = () => {
    onOpenInPanel(simulator.id);
    dockSimulator(key);
  };

  const begin = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    const corner = (event.target as Element).closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined;
    gesture.current = { pointerId: event.pointerId, from: { x: event.clientX, y: event.clientY }, start: frame, corner };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    event.preventDefault();
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const now = gesture.current;
    if (now?.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - now.from.x, y: event.clientY - now.from.y };
    setMoving(now.corner ? resizeFloat(now.start, now.corner, delta, aspect, room) : dragFloat(now.start, delta, room));
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    if (moving) keepFloatSpot(key, moving);
    setMoving(undefined);
  };

  return (
    <div ref={setLayer} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {room.width > 0 && room.height > 0 && (
        <section
          aria-label={`${simulator.name}, floating`}
          tabIndex={-1}
          className="group/float pointer-events-auto absolute touch-none select-none outline-none"
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            dock();
          }}
        >
          <SimulatorView simulator={simulator} api={api} {...(hostId ? { hostId } : {})} visible floating={{ onDock: dock, onClose: close, onAspect: setAspect }} />
          {(Object.keys(CORNERS) as Corner[]).map((corner) => (
            <span key={corner} aria-hidden data-corner={corner} className={cn("absolute z-10 size-4", CORNERS[corner])} />
          ))}
        </section>
      )}
    </div>
  );
}
