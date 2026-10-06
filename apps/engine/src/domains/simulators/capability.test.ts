import { expect, test } from "bun:test";
import { withSimulatorTools } from "./capability";

test("an agent's env gets agent-device on PATH and the resolved Xcode as DEVELOPER_DIR", () => {
  expect(withSimulatorTools({ PATH: "/usr/bin", HOME: "/h" }, { binDir: "/tools/bin", developerDir: "/Applications/Xcode.app/Contents/Developer" })).toEqual({
    PATH: "/tools/bin:/usr/bin",
    HOME: "/h",
    DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
  });
  expect(withSimulatorTools({ PATH: "/usr/bin" }, { developerDir: "/X/Contents/Developer" })).toEqual({ PATH: "/usr/bin", DEVELOPER_DIR: "/X/Contents/Developer" });
});

test("without simulator access the env is left alone", () => {
  const env = { PATH: "/usr/bin" };
  expect(withSimulatorTools(env, undefined)).toBe(env);
  expect(withSimulatorTools(env, {})).toBe(env);
});
