import * as Integrity from "@expo/app-integrity";
import Constants from "expo-constants";
import { isDevice } from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { AppState, Settings } from "react-native";
import { liveActivity } from "../../../modules/live-activity";
import type { HostConnection } from "../../platform/connection";
import { hosts } from "../hosts";
import { appSettings } from "../settings";
import { alertsToRemove, approvalOf, pairedHostOf, pushHostId, readsOf, reconcileQueries, sessionLink, sessionOfUrl, type DeliveredAlert, type SessionRef } from "./payload";
import { PushRelay, RELAY_URL, type RelayState } from "./relay";
import { PushSync } from "./registration";

const READ_TASK = "telar-read-sync";
const TOKEN_KEY = "telar.apns.token";
const ASKED_KEY = "telar.notifications.askedAfterPairing";
const RELAY_KEY = "pushRelay";
const APPROVE = "TELAR_APPROVE";
const OPEN = "TELAR_OPEN";

const topic = Constants.expoConfig?.ios?.bundleIdentifier ?? "io.github.novarix.telar";
const sandbox = (Constants.expoConfig?.extra as { apsEnvironment?: string } | undefined)?.apsEnvironment === "development";

const relay = new PushRelay({
  url: RELAY_URL,
  bundle: topic,
  sandbox,
  attest: { isSupported: Integrity.isSupported, generateKey: Integrity.generateKeyAsync, attestKey: Integrity.attestKeyAsync, generateAssertion: Integrity.generateAssertionAsync },
  fetch: (url, init) => fetch(url, init),
  load: async () => {
    const raw = await SecureStore.getItemAsync(RELAY_KEY);
    return raw ? (JSON.parse(raw) as RelayState) : undefined;
  },
  save: (state) => SecureStore.setItemAsync(RELAY_KEY, JSON.stringify(state), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
});

const allowed = async () => {
  const { status, ios } = await Notifications.getPermissionsAsync();
  return status === "granted" || ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
};

const registry = new PushSync({
  topic,
  sandbox,
  simulator: !isDevice,
  hosts: () => hosts.list().map((host) => ({ hostId: pushHostId(host.hostId), name: host.name, register: (body) => host.request("PUT", "/v2/mobile/push", body) })),
  prefs: () => appSettings.current,
  allowed,
  card: () => {
    const token = liveActivity?.card()?.token;
    return { enabled: liveActivity?.enabled() ?? false, ...(token ? { token } : {}) };
  },
  credential: (hostId, tokens) => relay.credential(hostId, tokens),
  revoke: (hostId) => relay.revoke(hostId),
});

let visible: SessionRef | undefined;

const pairedHost = (pushId: string): HostConnection | undefined => hosts.get(pairedHostOf(pushId, hosts.list().map((host) => host.hostId)) ?? pushId);

const delivered = async (): Promise<DeliveredAlert[]> =>
  (await Notifications.getPresentedNotificationsAsync()).map(({ request }) => ({
    identifier: request.identifier,
    threadIdentifier: request.content.threadIdentifier,
    url: payloadOf(request).url,
  }));

/** A remote alert's own keys sit beside `aps` in the trigger's payload, not in `content.data`. */
function payloadOf(request: Notifications.NotificationRequest): Record<string, unknown> {
  const trigger = request.trigger as { type?: string; payload?: Record<string, unknown> } | null;
  return trigger?.type === "push" && trigger.payload ? trigger.payload : (request.content.data ?? {});
}

async function clearDelivered(sessions: SessionRef[]): Promise<boolean> {
  if (sessions.length === 0) return false;
  const ids = alertsToRemove(await delivered(), sessions);
  await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id)));
  return ids.length > 0;
}

/** Drops alerts for sessions someone already read while this phone wasn't listening. */
async function reconcile(): Promise<void> {
  const cleared: SessionRef[] = [];
  for (const [hostId, ids] of reconcileQueries(await delivered())) {
    const host = pairedHost(hostId);
    if (!host) continue;
    const answer = await host.request<{ cleared: string[] }>("GET", `/v2/mobile/read-state?ids=${encodeURIComponent(ids.join(","))}`).catch(() => undefined);
    for (const sessionId of answer?.cleared ?? []) if (ids.includes(sessionId)) cleared.push({ hostId, sessionId });
  }
  await clearDelivered(cleared);
}

TaskManager.defineTask<{ data?: Record<string, unknown> }>(READ_TASK, async ({ data }) => {
  const changed = await clearDelivered(readsOf(data?.data)).catch(() => false);
  return changed ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
});

async function fetchToken(): Promise<void> {
  const { data } = await Notifications.getDevicePushTokenAsync().catch(() => ({ data: undefined }));
  if (typeof data !== "string") return;
  Settings.set({ [TOKEN_KEY]: data });
  await registry.setToken(data);
}

/** Asks once, like Swift; a refusal turns the switch back off. */
async function enable(): Promise<void> {
  const { granted } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
  if (!granted) appSettings.set("notifications", false);
  await fetchToken();
  await registry.sync();
}

async function promptAfterPairing(): Promise<void> {
  if (hosts.list().length === 0 || Settings.get(ASKED_KEY) || appSettings.current.notifications) return;
  Settings.set({ [ASKED_KEY]: true });
  appSettings.set("notifications", true);
}

async function approve(hostId: string, sessionId: string, requestId: string): Promise<void> {
  const host = pairedHost(hostId);
  const done = host ? await host.call(false, () => host.client.resolveRequest(sessionId, requestId, { decision: "accept" })).then(() => true, () => false) : false;
  if (done) return;
  const sound = appSettings.current.sound;
  await Notifications.scheduleNotificationAsync({
    identifier: `approve-failed-${requestId}`,
    content: { title: "Telar", body: "Couldn't approve. Open Telar to review the request.", data: { url: `telar://session?host=${hostId}&id=${sessionId}` }, categoryIdentifier: "TELAR_SESSION", ...(sound === "off" ? {} : { sound: `telar-${sound}-error.caf` }) },
    trigger: null,
  });
}

/** The session route a tap on a notification asks for, or undefined for actions that stay in the background. */
function linkOf(response: Notifications.NotificationResponse | null | undefined): string | undefined {
  if (!response || (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER && response.actionIdentifier !== OPEN)) return undefined;
  const ref = sessionOfUrl(payloadOf(response.notification.request).url);
  return ref ? sessionLink({ ...ref, hostId: pairedHost(ref.hostId)?.hostId ?? ref.hostId }) : undefined;
}

export const launchLink = (): string | undefined => linkOf(Notifications.getLastNotificationResponse());

export function onNotificationLink(listener: (url: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const link = linkOf(response);
    if (link) return listener(link);
    const approval = response.actionIdentifier === APPROVE ? approvalOf(payloadOf(response.notification.request)) : undefined;
    if (approval) void approve(approval.hostId, approval.sessionId, approval.requestId);
  });
  return () => subscription.remove();
}

/** The session on screen: its alerts are cleared and new ones for it stay quiet. */
export function setVisibleSession(ref: SessionRef | undefined): void {
  visible = ref;
  if (ref) void clearDelivered([ref]);
}

let started = false;

export function startPush(): void {
  if (started) return;
  started = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const ref = sessionOfUrl(payloadOf(notification.request).url);
      const quiet = ref !== undefined && visible !== undefined && pushHostId(ref.hostId) === pushHostId(visible.hostId) && ref.sessionId === visible.sessionId;
      return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
  void Notifications.setNotificationCategoryAsync("TELAR_REQUEST", [
    { identifier: APPROVE, buttonTitle: "Approve", options: { opensAppToForeground: false, isAuthenticationRequired: true } },
    { identifier: OPEN, buttonTitle: "Open", options: { opensAppToForeground: true } },
  ]);
  void Notifications.setNotificationCategoryAsync("TELAR_SESSION", [{ identifier: OPEN, buttonTitle: "Open", options: { opensAppToForeground: true } }]);
  void Notifications.registerTaskAsync(READ_TASK).catch(() => undefined);
  Notifications.addPushTokenListener(({ data }) => {
    if (typeof data !== "string") return;
    Settings.set({ [TOKEN_KEY]: data });
    void registry.setToken(data);
  });

  const prefsKey = () => {
    const { notifications, completions, previews, sound, liveActivity: card } = appSettings.current;
    return `${notifications}:${completions}:${previews}:${sound}:${card}`;
  };
  let notifications = appSettings.current.notifications;
  let prefs = prefsKey();
  appSettings.subscribe(() => {
    if (prefsKey() === prefs) return;
    prefs = prefsKey();
    const turnedOn = appSettings.current.notifications && !notifications;
    notifications = appSettings.current.notifications;
    void (turnedOn ? enable() : registry.sync());
  });
  hosts.subscribe(() => {
    void promptAfterPairing();
    void registry.sync();
    void reconcile();
  });
  liveActivity?.addListener("onPushToken", () => void registry.sync());
  liveActivity?.addListener("onStateChange", ({ state }) => {
    if (state === "ended" || state === "dismissed") void registry.sync();
  });
  AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    void registry.sync();
    void reconcile();
  });

  const stored: unknown = Settings.get(TOKEN_KEY);
  if (typeof stored === "string" && stored) void registry.setToken(stored);
  if (appSettings.current.notifications || appSettings.current.liveActivity) void fetchToken();
  void reconcile();
}
