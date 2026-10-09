import { AppState } from "react-native";
import { liveActivity, type LiveActivityModule } from "../../../modules/live-activity";
import { hosts } from "../hosts";
import { cardSessions, inboxStore, type HostSnapshot } from "../sessions";
import { appSettings } from "../settings";
import { CARD_STALE_SECONDS, initialCardState, isCardActive, type CardHost } from "./card";

function cardHosts(snapshots: readonly HostSnapshot[]): CardHost[] {
  return snapshots.flatMap(({ hostId, snapshot }) => {
    const connection = hosts.get(hostId);
    const kind = connection?.state.kind;
    if (!snapshot.answer || snapshot.failed || kind === "backoff" || kind === "blocked") return [];
    const projects = new Map(snapshot.answer.projects.map((project) => [project.id, project.name]));
    return [{ hostId, name: connection?.name ?? "", sessions: cardSessions(snapshot.answer, Date.now()), projects }];
  });
}

/** Starts the Lock Screen card when the app is open and work is running; the relay keeps it current from then on. */
export function startLiveActivityCard(native: LiveActivityModule | null = liveActivity): () => void {
  if (!native) return () => {};
  let dismissed = false;

  const start = (): void => {
    if (AppState.currentState !== "active") return;
    const live = cardHosts(inboxStore.read());
    if (!live.some((host) => host.sessions.some(isCardActive))) {
      dismissed = false;
      return;
    }
    const { liveActivity: enabled, previews } = appSettings.current;
    if (!enabled || dismissed || !native.enabled() || native.card()) return;
    try {
      native.start(JSON.stringify(initialCardState(live, previews, Date.now())), CARD_STALE_SECONDS);
    } catch (error) {
      console.warn("Couldn't start a Live Activity", error);
    }
  };

  let settings = appSettings.current;
  const settingsChanged = (): void => {
    const next = appSettings.current;
    if (settings.liveActivity && !next.liveActivity) void native.endAll();
    if (settings.previews && !next.previews) void native.conceal();
    settings = next;
    start();
  };

  if (!settings.liveActivity) void native.endAll();
  void native.endOthers();
  start();
  const unsubscribe = [inboxStore.subscribe(start), appSettings.subscribe(settingsChanged)];
  const dismissal = native.addListener("onStateChange", ({ state }) => {
    if (state === "dismissed") dismissed = true;
  });
  const foreground = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    void native.endOthers();
    start();
  });
  return () => {
    for (const stop of unsubscribe) stop();
    dismissal.remove();
    foreground.remove();
  };
}
