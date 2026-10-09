import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { addressUrl, BrowserWatch } from "./watch";

const PHOTO_MS = 3_000;
const LIST_MS = 10_000;

/** The session's browser while the app is in front: photographed every 3 s while `photograph` holds, else its page list every 10 s. */
export function useBrowser(host: HostConnection, sessionId: string, photograph: boolean) {
  const watch = useMemo(() => new BrowserWatch(), [host, sessionId]);
  const wantsPhoto = useRef(photograph);
  const restart = useRef<() => void>(() => {});

  useEffect(() => {
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (mine: number) => {
      const photo = wantsPhoto.current;
      try {
        const { browser } = await host.call(true, () => host.client.browserState(sessionId, { screenshot: photo }));
        if (mine === generation) watch.absorb(browser);
      } catch (error) {
        if (mine === generation) watch.fail(error);
      }
      if (mine === generation) timer = setTimeout(() => void tick(mine), photo ? PHOTO_MS : LIST_MS);
    };
    const run = (active: boolean) => {
      generation++;
      clearTimeout(timer);
      if (active) void tick(generation);
    };
    restart.current = () => run(AppState.currentState === "active");
    restart.current();
    const subscription = AppState.addEventListener("change", (state) => run(state === "active"));
    return () => {
      subscription.remove();
      generation++;
      clearTimeout(timer);
    };
  }, [host, sessionId, watch]);

  useEffect(() => {
    if (wantsPhoto.current === photograph) return;
    wantsPhoto.current = photograph;
    if (photograph) restart.current();
  }, [photograph]);

  const open = useCallback(
    async (typed: string) => {
      const known = new Set(watch.state().snapshot?.tabs.map((page) => page.id));
      const { browser } = await host.call(false, () => host.client.browserOpen(sessionId, addressUrl(typed)));
      return watch.absorb(browser, known);
    },
    [host, sessionId, watch],
  );

  return { view: useSyncExternalStore(watch.subscribe, watch.state), open };
}
