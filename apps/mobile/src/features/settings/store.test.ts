import { describe, expect, test } from "bun:test";
import { notificationsSummary, SettingsStore, type Backend } from "./store";

function memory(initial: Record<string, unknown> = {}): Backend & { values: Record<string, unknown> } {
  const values = { ...initial };
  return { values, get: (key) => values[key], set: (next) => Object.assign(values, next) };
}

describe("SettingsStore", () => {
  test("a fresh phone gets the Swift app's defaults", () => {
    expect(new SettingsStore(memory()).current).toEqual({
      groupBy: "flat",
      chatWidth: "comfortable",
      notifications: false,
      completions: true,
      previews: false,
      sound: "hilo",
      liveActivity: true,
    });
  });

  test("reads what the Swift app stored under the same keys, and ignores junk", () => {
    const store = new SettingsStore(memory({ "telar.chatWidth": "wide", "telar.notifications.enabled": 1, "telar.notifications.sounds": "loud", "telar.activities.enabled": false }));
    expect(store.current).toMatchObject({ chatWidth: "wide", notifications: true, sound: "hilo", liveActivity: false });
  });

  test("a change persists, survives a relaunch and tells subscribers once", () => {
    const backend = memory();
    const store = new SettingsStore(backend);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set("sound", "felt");
    store.set("sound", "felt");
    expect(calls).toBe(1);
    expect(new SettingsStore(backend).current.sound).toBe("felt");
  });

  test("an unsubscribed listener hears nothing", () => {
    const store = new SettingsStore(memory());
    let calls = 0;
    store.subscribe(() => calls++)();
    store.set("previews", true);
    expect(calls).toBe(0);
  });
});

describe("notificationsSummary", () => {
  test("names the alerts and the Live Activity", () => {
    expect(notificationsSummary({ notifications: false, liveActivity: true })).toBe("Off · Live Activity on");
    expect(notificationsSummary({ notifications: true, liveActivity: false })).toBe("On");
  });
});
