import { expect, test } from "bun:test";
import { isMutedIn, mutedList, mutedSessionsOf, toggledMute } from "./mute";

const ref = { hostId: "host_0a5c3e2e-8d1f-4c6b-9a7e-2f4b6c8d0e1a", sessionId: "session_1" };

test("muting stores the session the way the Swift app does, and toggling again unmutes it", () => {
  const muted = toggledMute([], ref);
  expect(muted).toEqual(["telar://session?host=0A5C3E2E-8D1F-4C6B-9A7E-2F4B6C8D0E1A&id=session_1"]);
  expect(isMutedIn(muted, ref)).toBe(true);
  expect(toggledMute(muted, ref)).toEqual([]);
});

test("a host is told only about its own muted sessions, whichever form its id takes", () => {
  const muted = [...toggledMute([], ref), "telar://session?host=FFFFFFFF-0000-4000-8000-000000000000&id=session_2", "not a link"];
  expect(mutedSessionsOf(muted, "0a5c3e2e-8d1f-4c6b-9a7e-2f4b6c8d0e1a")).toEqual(["session_1"]);
  expect(mutedSessionsOf(muted, "host_ffffffff-0000-4000-8000-000000000000")).toEqual(["session_2"]);
});

test("a stored value that isn't a list of links reads as nothing muted", () => {
  expect(mutedList(undefined)).toEqual([]);
  expect(mutedList(["a", 3])).toEqual(["a"]);
});
