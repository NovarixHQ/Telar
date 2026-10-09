import { MAX_SIMULATOR_INPUT_EVENTS, type EngineEvent, type SimulatorInput, type SimulatorSummary } from "@telar/engine-client";

export type Orientation = "portrait" | "landscape_left" | "portrait_upside_down" | "landscape_right";
export type ScreenConfig = { width: number; height: number; orientation: Orientation };
export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };
export type Point = { x: number; y: number };

const ORIENTATIONS: readonly Orientation[] = ["portrait", "landscape_left", "portrait_upside_down", "landscape_right"];
const ROTATION: Record<Orientation, number> = { portrait: 0, landscape_left: 90, landscape_right: -90, portrait_upside_down: 180 };

export const nextOrientation = (orientation: Orientation): Orientation => ORIENTATIONS[(ORIENTATIONS.indexOf(orientation) + 1) % ORIENTATIONS.length]!;

export const isViewable = (simulator: SimulatorSummary) => simulator.booted && simulator.platform === "ios" && !simulator.physical;

export const simulatorIcon = (simulator: SimulatorSummary): "applewatch" | "iphone" => (simulator.pairedWith ? "applewatch" : "iphone");

export function readScreenConfig(value: unknown): ScreenConfig | undefined {
  const config = value as Partial<ScreenConfig> | null;
  if (!config || typeof config.width !== "number" || typeof config.height !== "number") return undefined;
  return { width: config.width, height: config.height, orientation: config.orientation && ORIENTATIONS.includes(config.orientation) ? config.orientation : "portrait" };
}

/** The simulators this session opened, latest last, folded from its journal. */
export function sessionSimulators(events: readonly EngineEvent[]): string[] {
  let ids: string[] = [];
  for (const event of events) {
    if (event.type === "simulator.opened") ids = [...ids.filter((id) => id !== event.simulator.id), event.simulator.id];
    else if (event.type === "simulator.closed") ids = ids.filter((id) => id !== event.simulatorId);
  }
  return ids;
}

/** Running simulators first, this session's latest ahead of the rest; ones that can't be shown last. */
export function listSimulators(simulators: readonly SimulatorSummary[], owned: readonly string[]): SimulatorSummary[] {
  const rank = (simulator: SimulatorSummary) => {
    const mine = owned.lastIndexOf(simulator.id);
    return isViewable(simulator) ? (mine >= 0 ? owned.length - mine : owned.length + 1) : owned.length + 2;
  };
  return simulators.map((simulator, index) => ({ simulator, index })).sort((a, b) => rank(a.simulator) - rank(b.simulator) || a.index - b.index).map(({ simulator }) => simulator);
}

/** How the stream's frame sits in the view: a frame that arrives already sideways is drawn as it comes. */
export function screenMapping(frame: Size, screen: ScreenConfig | undefined) {
  const rawPortrait = screen ? screen.width <= screen.height : true;
  const orientation: Orientation = rawPortrait ? (screen?.orientation ?? "portrait") : "portrait";
  const rotation = ROTATION[orientation];
  const sideways = Math.abs(rotation) === 90;
  const shown = sideways ? { width: frame.height, height: frame.width } : frame;
  const fitted = (container: Size): Rect => {
    if (shown.width <= 0 || shown.height <= 0 || container.width <= 0 || container.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
    const scale = Math.min(container.width / shown.width, container.height / shown.height);
    const width = shown.width * scale;
    const height = shown.height * scale;
    return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
  };
  const devicePoint = (location: Point, container: Size): Point | undefined => {
    const rect = fitted(container);
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    const x = Math.min(Math.max((location.x - rect.x) / rect.width, 0), 1);
    const y = Math.min(Math.max((location.y - rect.y) / rect.height, 0), 1);
    if (orientation === "landscape_left") return { x: y, y: 1 - x };
    if (orientation === "landscape_right") return { x: 1 - y, y: x };
    if (orientation === "portrait_upside_down") return { x: 1 - x, y: 1 - y };
    return { x, y };
  };
  return { rotation, sideways, fitted, devicePoint };
}

const isMove = (event: SimulatorInput) => event.type === "touch" && event.phase === "move";

/** Drops every move that another move follows, so a slow link replays the drag's latest point, not its history. */
export const coalesce = (events: readonly SimulatorInput[]) => events.filter((event, index) => !(isMove(event) && events[index + 1] && isMove(events[index + 1]!)));

/** One request in flight per simulator; what queues meanwhile goes out coalesced in the next batch. */
export function inputQueue(post: (events: SimulatorInput[]) => Promise<unknown>, onResult: (failure: unknown) => void) {
  let pending: SimulatorInput[] = [];
  let sending = false;
  const flush = () => {
    if (sending || pending.length === 0) return;
    pending = coalesce(pending);
    const batch = pending.slice(0, MAX_SIMULATOR_INPUT_EVENTS);
    pending = pending.slice(batch.length);
    sending = true;
    post(batch).then(
      () => onResult(undefined),
      (failure: unknown) => onResult(failure ?? new Error("The input was not delivered.")),
    ).finally(() => {
      sending = false;
      flush();
    });
  };
  return {
    send(event: SimulatorInput) {
      pending.push(event);
      flush();
    },
    clear() {
      pending = [];
    },
  };
}

export const hubPath = (id: string, resource: "config" | "stream.mjpeg") => `/v2/simulators/hub/vendor/serve-sim/helper/${encodeURIComponent(id)}/${resource}`;
