import type { SimulatorInput, SimulatorsState } from "@telar/engine-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { viaCockpit, type HostConnection } from "../../platform/connection";
import { hubPath, inputQueue, nextOrientation, readScreenConfig, type Orientation, type ScreenConfig, type Size } from "./model";

const LIST_MS = 12_000;
const SETTLING_MS = 3_000;
const SCREEN_MS = 3_000;
const RETRY_MS = 2_000;
const ROTATE_SETTLE_MS = 600;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return active;
}

/** The computer's simulators, read while the app is in front, and whether this device may drive them. */
export function useSimulatorList(host: HostConnection, active: boolean) {
  const [state, setState] = useState<SimulatorsState>();
  const [failure, setFailure] = useState<string>();
  const [canDrive, setCanDrive] = useState(false);
  const read = useCallback(
    () =>
      host.call(true, () => host.client.simulators()).then(
        ({ simulators }) => (setState(simulators), setFailure(undefined)),
        (error) => setFailure(message(error)),
      ),
    [host],
  );
  useEffect(() => {
    host.request<{ callerRole?: string }>("GET", "/v2/remote").then((status) => setCanDrive(status.callerRole !== "observer"), () => setCanDrive(true));
  }, [host]);
  const settling = !state || state.status === "idle" || state.status === "installing" || state.status === "starting";
  useEffect(() => {
    if (!active) return;
    void read();
    const timer = setInterval(() => void read(), settling ? SETTLING_MS : LIST_MS);
    return () => clearInterval(timer);
  }, [read, active, settling]);
  return { state, failure, canDrive, read };
}

export type Viewer = {
  url: string | undefined;
  frame: Size | undefined;
  screen: ScreenConfig | undefined;
  failed: string | undefined;
  notice: string | undefined;
  onStream: (event: { type: "frame"; width: number; height: number } | { type: "error" }) => void;
  send: (event: SimulatorInput) => void;
  rotate: () => void;
  reload: () => void;
};

/** One simulator's stream address, screen orientation and input, alive while `active`. */
export function useSimulatorViewer(host: HostConnection, id: string, active: boolean, canDrive: boolean): Viewer {
  const [url, setUrl] = useState<string>();
  const [frame, setFrame] = useState<Size>();
  const [screen, setScreen] = useState<ScreenConfig>();
  const [failed, setFailed] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const rotation = useRef<Orientation | undefined>(undefined);

  useEffect(() => {
    if (!active) return setUrl(undefined);
    let live = true;
    host
      .call(true, () => host.client.simulatorStreamTicket())
      .then(({ ticket }) => {
        if (!live) return;
        setUrl(`${viaCockpit(host.client.locate(hubPath(id, "stream.mjpeg")).url)}?ticket=${encodeURIComponent(ticket)}`);
      })
      .catch((error) => {
        if (!live) return;
        setFailed(message(error));
        setTimeout(() => live && setAttempt((count) => count + 1), RETRY_MS);
      });
    return () => {
      live = false;
    };
  }, [host, id, active, attempt]);

  const readScreen = useCallback(
    () =>
      host.call(true, () => host.request<unknown>("GET", hubPath(id, "config"))).then((value) => {
        const fresh = readScreenConfig(value);
        if (!fresh) return;
        setScreen((current) => {
          if (fresh.orientation !== current?.orientation) rotation.current = fresh.orientation;
          return current && current.width === fresh.width && current.height === fresh.height && current.orientation === fresh.orientation ? current : fresh;
        });
      }, () => undefined),
    [host, id],
  );
  useEffect(() => {
    if (!active) return;
    void readScreen();
    const timer = setInterval(() => void readScreen(), SCREEN_MS);
    return () => clearInterval(timer);
  }, [readScreen, active]);

  const queue = useMemo(
    () =>
      inputQueue(
        (events) => host.call(false, () => host.client.sendSimulatorInput(id, events)),
        (failure) => setNotice(failure === undefined ? undefined : message(failure)),
      ),
    [host, id],
  );
  useEffect(() => () => queue.clear(), [queue]);

  const send = useCallback((event: SimulatorInput) => canDrive && queue.send(event), [queue, canDrive]);
  const onStream = useCallback((event: { type: "frame"; width: number; height: number } | { type: "error" }) => {
    if (event.type === "frame") {
      setFrame((current) => (current?.width === event.width && current.height === event.height ? current : { width: event.width, height: event.height }));
      setFailed(undefined);
      return;
    }
    setFailed("The stream stopped. Trying again…");
    setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
  }, []);
  return {
    url,
    frame,
    screen,
    failed,
    notice,
    onStream,
    send,
    rotate: () => {
      const next = nextOrientation(rotation.current ?? screen?.orientation ?? "portrait");
      rotation.current = next;
      send({ type: "orientation", orientation: next });
      setTimeout(() => void readScreen(), ROTATE_SETTLE_MS);
    },
    reload: () => {
      setFrame(undefined);
      setAttempt((count) => count + 1);
    },
  };
}
